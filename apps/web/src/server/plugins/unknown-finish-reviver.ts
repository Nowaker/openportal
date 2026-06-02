import { definePlugin } from "nitro";

import { getOpencodeClient, resolveSessionDirectory } from "../lib/opencode-client";
import { listConfiguredServers } from "../lib/server-registry";
import {
  detectUnknownFinishTerminalFailure,
  UNKNOWN_FINISH_REVIVE_PROMPT,
  UnknownFinishReviveGuard,
} from "../lib/unknown-finish-reviver";

const STARTUP_DELAY_MS = 8_000;
const SCAN_INTERVAL_MS = 30_000;
const MAX_SESSION_FETCH_CONCURRENCY = 3;

const guard = new UnknownFinishReviveGuard();

interface SessionLike {
  id?: string;
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

  const directory = await resolveSessionDirectory(port, sessionId);
  console.warn(
    `[unknown-finish-reviver] revive sid=${sessionId} port=${port} reason=${detection.reason} signature=${detection.signature}`,
  );

  await client.session.promptAsync({
    path: { id: sessionId },
    query: directory ? { directory } : undefined,
    body: {
      parts: [{ type: "text", text: UNKNOWN_FINISH_REVIVE_PROMPT }],
    },
  });
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
