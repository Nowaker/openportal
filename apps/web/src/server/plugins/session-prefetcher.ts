import { definePlugin } from "nitro";
import { listConfiguredServers } from "../lib/server-registry";
import { getOpencodeClient } from "../lib/opencode-client";
import { setCachedMessagesLongLived } from "../lib/messages-cache";

const STARTUP_DELAY_MS = 5_000;
const REFRESH_INTERVAL_MS = 60_000;
const MAX_CONCURRENT_FETCHES = 4;

interface SessionLike {
  id?: string;
  time?: { updated?: string | number };
}

interface MessageLike {
  info?: {
    role?: string;
    time?: { completed?: string | number | null };
    finish?: string | null;
  };
}

function isInFlight(messages: unknown[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1] as MessageLike;
  if (last?.info?.role !== "assistant") return false;
  const completed = last.info.time?.completed;
  if (completed !== null && completed !== undefined) return false;
  const finish = last.info.finish;
  if (finish !== null && finish !== undefined) return false;
  return true;
}

async function prefetchSession(
  port: number,
  sessionId: string,
): Promise<boolean> {
  try {
    const client = await getOpencodeClient(port);
    const res = await client.session.messages({ path: { id: sessionId } });
    const data = (res.data ?? []) as unknown[];
    if (isInFlight(data)) {
      setCachedMessagesLongLived(sessionId, data);
      return true;
    }
  } catch {
    /* opencode unreachable - skip this session, prefetcher retries later */
  }
  return false;
}

async function walkPort(port: number): Promise<number> {
  let warmed = 0;
  try {
    const client = await getOpencodeClient(port);
    const res = await client.session.list();
    const sessions = (res.data ?? []) as SessionLike[];
    const ids = sessions
      .map((s) => (typeof s.id === "string" ? s.id : null))
      .filter((id): id is string => id !== null);

    for (let i = 0; i < ids.length; i += MAX_CONCURRENT_FETCHES) {
      const batch = ids.slice(i, i + MAX_CONCURRENT_FETCHES);
      const results = await Promise.all(
        batch.map((id) => prefetchSession(port, id)),
      );
      warmed += results.filter(Boolean).length;
    }
  } catch {
    /* opencode unreachable - try next refresh */
  }
  return warmed;
}

async function walkAll(): Promise<void> {
  let servers: ReturnType<typeof listConfiguredServers> = [];
  try {
    servers = listConfiguredServers();
  } catch {
    return;
  }
  const ports = new Set<number>();
  for (const server of servers) {
    if (typeof server.port === "number" && server.port > 0) {
      ports.add(server.port);
    }
  }
  for (const port of ports) {
    await walkPort(port);
  }
}

export default definePlugin(() => {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const loop = async () => {
    if (stopped) return;
    try {
      await walkAll();
    } catch {
      /* swallow errors - the prefetcher is best-effort */
    }
    if (stopped) return;
    timer = setTimeout(() => {
      void loop();
    }, REFRESH_INTERVAL_MS);
  };

  timer = setTimeout(() => {
    void loop();
  }, STARTUP_DELAY_MS);

  return {
    close() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
});
