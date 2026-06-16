// Backend auto-approve worker.
//
// opencode 1.16.x scopes pending permissions per-directory (InstanceState),
// and its /event stream is location-filtered: handlers/event.ts does
// `Stream.filter(e => e.location.directory === subscribed directory)`. A
// bare /event subscription (no ?directory=) therefore only ever sees events
// for opencode's process.cwd instance and NEVER receives permission.asked
// from a project-directory session. The previous SSE-on-bare-/event design
// was consequently blind to virtually every real permission ask, so
// auto-approve never fired. Likewise GET /permission without ?directory=
// resolves the cwd instance (empty / cold-init hang).
//
// This worker instead POLLS GET /permission?directory=<dir> for each active
// directory of each configured server, every POLL_INTERVAL_MS. For each
// pending permission it records the ask (for the durable chat-log synthetic
// message) and, when the effective auto-approve flag is on for the session,
// replies via the V1 reply route scoped to that directory (replyToPermission
// threads the directory and records the resolution). The active-directory
// set is refreshed from the session list every DIR_REFRESH_INTERVAL_MS.
//
// Lives independent of any browser tab - that is the entire point.

import { definePlugin } from "nitro";
import { listConfiguredServers } from "../lib/server-registry";
import { getEffectiveAutoApprove } from "../lib/auto-approve-state";
import { replyToPermission, type KnownPermission } from "../lib/permission-reply";
import { recordAsked } from "../lib/permission-log";
import { fetchOpencode } from "../lib/opencode-client";
import { getCachedSessions } from "../lib/sessions-cache";

const POLL_INTERVAL_MS = 2_000;
const DIR_REFRESH_INTERVAL_MS = 30_000;
const DIR_RECENCY_MS = 7 * 24 * 60 * 60 * 1000;

interface PendingPermission {
  id?: unknown;
  sessionID?: unknown;
  permission?: unknown;
  patterns?: unknown;
  metadata?: { description?: unknown } | null;
  tool?: { messageID?: unknown; callID?: unknown; name?: unknown } | null;
}

interface SessionLike {
  directory?: unknown;
  time?: { updated?: unknown; created?: unknown } | null;
}

function permissionsFromResponse(body: unknown): PendingPermission[] {
  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data?: unknown }).data
      : body;
  return Array.isArray(data) ? (data as PendingPermission[]) : [];
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// requestIds already auto-replied to, so a permission still listed in the
// brief window before opencode reaps it is not replied to twice. Replied
// permissions vanish from the list, so this set only needs to cover the
// poll-overlap window; growth is negligible.
const autoFired = new Set<string>();

const dirCache = new Map<string, { dirs: string[]; ts: number }>();

async function activeDirectories(
  serverId: string,
  port: number,
): Promise<string[]> {
  const cached = dirCache.get(serverId);
  if (cached && Date.now() - cached.ts < DIR_REFRESH_INTERVAL_MS) {
    return cached.dirs;
  }

  let sessions: SessionLike[] = [];
  const fromCache = getCachedSessions(port) as SessionLike[] | null;
  if (fromCache && fromCache.length > 0) {
    sessions = fromCache;
  } else {
    try {
      const res = await fetchOpencode(
        port,
        "/experimental/session?archived=true&limit=10000",
      );
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (Array.isArray(body)) sessions = body as SessionLike[];
      }
    } catch {
      // leave empty - next refresh retries
    }
  }

  const cutoff = Date.now() - DIR_RECENCY_MS;
  const set = new Set<string>();
  for (const s of sessions) {
    const dir = asStr(s?.directory);
    if (!dir) continue;
    const updated =
      typeof s?.time?.updated === "number"
        ? s.time.updated
        : typeof s?.time?.created === "number"
          ? s.time.created
          : Date.now();
    if (updated >= cutoff) set.add(dir);
  }
  const dirs = [...set];
  dirCache.set(serverId, { dirs, ts: Date.now() });
  return dirs;
}

async function pollDirectory(
  serverId: string,
  port: number,
  directory: string,
): Promise<void> {
  let pending: PendingPermission[] = [];
  try {
    const res = await fetchOpencode(
      port,
      `/permission?directory=${encodeURIComponent(directory)}`,
    );
    pending = res.ok
      ? permissionsFromResponse(await res.json().catch(() => null))
      : [];
  } catch {
    return;
  }

  for (const p of pending) {
    const requestId = asStr(p.id);
    const sessionId = asStr(p.sessionID);
    if (!requestId || !sessionId) continue;

    const patterns = Array.isArray(p.patterns)
      ? p.patterns.filter((x): x is string => typeof x === "string")
      : [];
    recordAsked({
      serverId,
      sessionId,
      requestId,
      permissionType: asStr(p.permission),
      patterns,
      callId: asStr(p.tool?.callID),
      messageId: asStr(p.tool?.messageID),
      toolName: asStr(p.tool?.name),
      title: asStr(p.metadata?.description),
    });

    if (autoFired.has(requestId)) continue;
    if (!getEffectiveAutoApprove(sessionId)) continue;
    autoFired.add(requestId);

    const known: KnownPermission = {
      id: requestId,
      sessionID: sessionId,
      permission: asStr(p.permission) ?? undefined,
      patterns,
      metadata: { description: asStr(p.metadata?.description) ?? undefined },
      tool: {
        messageID: asStr(p.tool?.messageID) ?? undefined,
        callID: asStr(p.tool?.callID) ?? undefined,
        name: asStr(p.tool?.name) ?? undefined,
      },
    };
    void replyToPermission(port, requestId, "once", {
      auto: true,
      sessionId,
      directory,
      known,
    }).catch((err) => {
      autoFired.delete(requestId);
      console.warn(
        `[auto-approve-worker] reply failed (port=${port} req=${requestId}):`,
        err instanceof Error ? err.message : err,
      );
    });
  }
}

async function pollServer(serverId: string, port: number): Promise<void> {
  const dirs = await activeDirectories(serverId, port);
  await Promise.all(
    dirs.map((d) => pollDirectory(serverId, port, d).catch(() => {})),
  );
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    let servers: { id: string; port: number }[];
    try {
      servers = listConfiguredServers().map((s) => ({ id: s.id, port: s.port }));
    } catch (err) {
      console.warn(
        `[auto-approve-worker] server list read failed:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }
    await Promise.all(
      servers.map((s) => pollServer(s.id, s.port).catch(() => {})),
    );
  } finally {
    ticking = false;
  }
}

export default definePlugin(() => {
  void tick();
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }
});
