import { definePlugin } from "nitro";
import {
  getLastSeenStuckDetectorActionId,
  setLastSeenStuckDetectorActionId,
} from "../lib/instance-settings-state";

const PLUGIN_URL = "http://127.0.0.1:4098";
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const REPLAY_LIMIT = 500;

interface JournalEntry {
  id: number;
  ts?: string;
  source?: string;
  session_id?: string;
  cause?: string;
  action?: string;
  ok?: boolean;
  reason?: string;
  worker_url?: string;
  caller_ip?: string;
  http_method?: string;
  http_path?: string;
  extra?: unknown;
}

function processAction(entry: JournalEntry): void {
  if (typeof entry.id !== "number") return;
  setLastSeenStuckDetectorActionId(entry.id);
}

async function drainSince(since: number, signal: AbortSignal): Promise<number> {
  let cursor = since;
  while (!signal.aborted) {
    const url = `${PLUGIN_URL}/actions?since=${cursor}&limit=${REPLAY_LIMIT}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`stuck-detector /actions returned ${res.status}`);
    }
    const body = (await res.json()) as {
      actions?: JournalEntry[];
      max_id?: number;
    };
    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (actions.length === 0) {
      if (typeof body.max_id === "number" && body.max_id > cursor) {
        cursor = body.max_id;
        setLastSeenStuckDetectorActionId(cursor);
      }
      return cursor;
    }
    for (const entry of actions) {
      processAction(entry);
      if (typeof entry.id === "number" && entry.id > cursor) {
        cursor = entry.id;
      }
    }
    if (actions.length < REPLAY_LIMIT) return cursor;
  }
  return cursor;
}

async function streamSince(since: number, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${PLUGIN_URL}/actions/stream?since=${since}`, {
    signal,
    headers: { Accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`stuck-detector /actions/stream returned ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      let parsed: JournalEntry;
      try {
        parsed = JSON.parse(json) as JournalEntry;
      } catch {
        continue;
      }
      processAction(parsed);
    }
  }
}

async function runLoop(signal: AbortSignal): Promise<void> {
  let delay = RECONNECT_BASE_DELAY_MS;
  while (!signal.aborted) {
    try {
      const since = getLastSeenStuckDetectorActionId();
      const drained = await drainSince(since, signal);
      await streamSince(drained, signal);
      delay = RECONNECT_BASE_DELAY_MS;
    } catch (err) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("ECONNREFUSED") && !msg.includes("404")) {
        console.warn("[stuck-detector-journal-client]", msg);
      }
    }
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(RECONNECT_MAX_DELAY_MS, delay * 2);
  }
}

export default definePlugin(() => {
  const controller = new AbortController();
  void runLoop(controller.signal);
  return {
    close() {
      controller.abort();
    },
  };
});
