import { definePlugin } from "nitro";

import {
  fetchOpencode,
  getOpencodeClient,
  resolveSessionDirectory,
} from "../lib/opencode-client";
import { listConfiguredServers } from "../lib/server-registry";
import {
  detectUnknownFinishTerminalFailure,
  UNKNOWN_FINISH_REVIVE_PROMPT,
  UnknownFinishReviveGuard,
} from "../lib/unknown-finish-reviver";

const STARTUP_DELAY_MS = 8_000;
const SCAN_INTERVAL_MS = 30_000;
const MAX_SESSION_FETCH_CONCURRENCY = 3;
const NATIVE_RESUME_REPROBE_MS = 6 * 60 * 60 * 1000;

const guard = new UnknownFinishReviveGuard();
const nativeResumeSupportByPort = new Map<number, { supported: boolean; checkedAt: number }>();

interface SessionLike {
  id?: string;
}

interface ReviveTransport {
  nativeResume: (port: number, sessionId: string) => Promise<boolean>;
  promptAsync: (port: number, sessionId: string) => Promise<void>;
}

const DEFAULT_TRANSPORT: ReviveTransport = {
  nativeResume: attemptNativeResume,
  promptAsync: sendPromptAsyncRevive,
};

export function pickNativeResumeSupport(port: number, now = Date.now()): boolean | null {
  const info = nativeResumeSupportByPort.get(port);
  if (!info) return null;
  if (now - info.checkedAt > NATIVE_RESUME_REPROBE_MS) return null;
  return info.supported;
}

function rememberNativeResumeSupport(port: number, supported: boolean, now = Date.now()): void {
  nativeResumeSupportByPort.set(port, { supported, checkedAt: now });
}

export function setNativeResumeSupportForTest(port: number, supported: boolean): void {
  rememberNativeResumeSupport(port, supported, Date.now());
}

export function clearNativeResumeSupportCache(): void {
  nativeResumeSupportByPort.clear();
}

export async function attemptNativeResume(port: number, sessionId: string): Promise<boolean> {
  const path = `/session/${encodeURIComponent(sessionId)}/resume`;
  const res = await fetchOpencode(port, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.ok) {
    rememberNativeResumeSupport(port, true);
    return true;
  }
  if (res.status === 404 || res.status === 405) {
    rememberNativeResumeSupport(port, false);
    return false;
  }
  return false;
}

export async function sendPromptAsyncRevive(port: number, sessionId: string): Promise<void> {
  const client = await getOpencodeClient(port);
  const directory = await resolveSessionDirectory(port, sessionId);
  await client.session.promptAsync({
    path: { id: sessionId },
    query: directory ? { directory } : undefined,
    body: {
      parts: [{ type: "text", text: UNKNOWN_FINISH_REVIVE_PROMPT }],
    },
  });
}

export async function reviveUnknownFinishSession(
  port: number,
  sessionId: string,
  transport: ReviveTransport = DEFAULT_TRANSPORT,
): Promise<"native" | "prompt_async"> {
  const support = pickNativeResumeSupport(port);
  if (support === true) {
    if (await transport.nativeResume(port, sessionId)) return "native";
  } else if (support === null) {
    if (await transport.nativeResume(port, sessionId)) return "native";
  }
  await transport.promptAsync(port, sessionId);
  return "prompt_async";
}

async function maybeReviveSession(port: number, sessionId: string): Promise<void> {
  const client = await getOpencodeClient(port);
  const messagesRes = await client.session.messages({ path: { id: sessionId } });
  const messages = (messagesRes.data ?? []) as unknown[];
  const detection = detectUnknownFinishTerminalFailure(messages);
  const sessionKey = `${port}:${sessionId}`;

  if (!detection.shouldRevive || !detection.signature) {
    guard.resetSession(sessionKey);
    return;
  }

  if (!guard.shouldAttempt(sessionKey, detection.signature)) {
    console.log(
      `[unknown-finish-reviver] skip sid=${sessionId} port=${port} reason=guarded signature=${detection.signature}`,
    );
    return;
  }

  guard.recordAttempt(sessionKey, detection.signature);

  const strategy = await reviveUnknownFinishSession(port, sessionId);
  console.warn(
    `[unknown-finish-reviver] revive sid=${sessionId} port=${port} strategy=${strategy} reason=${detection.reason} signature=${detection.signature}`,
  );
}

async function walkPort(port: number): Promise<void> {
  const client = await getOpencodeClient(port);
  const sessionsRes = await client.session.list();
  const sessions = (sessionsRes.data ?? []) as SessionLike[];
  const ids = sessions
    .map((s) => (typeof s.id === "string" ? s.id : null))
    .filter((id): id is string => id !== null);

  for (let i = 0; i < ids.length; i += MAX_SESSION_FETCH_CONCURRENCY) {
    const batch = ids.slice(i, i + MAX_SESSION_FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (sid) => {
        try {
          await maybeReviveSession(port, sid);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[unknown-finish-reviver] sid=${sid} port=${port} failed: ${msg}`,
          );
        }
      }),
    );
  }
}

async function scanAllPorts(): Promise<void> {
  const ports = new Set<number>();
  for (const server of listConfiguredServers()) {
    if (typeof server.port === "number" && server.port > 0) ports.add(server.port);
  }
  for (const port of ports) {
    try {
      await walkPort(port);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[unknown-finish-reviver] port=${port} scan failed: ${msg}`);
    }
  }
}

export default definePlugin(() => {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    await scanAllPorts();
    if (stopped) return;
    timer = setTimeout(() => void loop(), SCAN_INTERVAL_MS);
  };

  timer = setTimeout(() => void loop(), STARTUP_DELAY_MS);

  return {
    close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
});
