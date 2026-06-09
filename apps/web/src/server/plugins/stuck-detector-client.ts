// Subscribes to the stuck-detector plugin's verdict stream at
// http://127.0.0.1:4098/verdicts/stream (Section A of the
// STUCK_DETECTION_INCORPORATION directive).
//
// On startup:
//   1. GET /verdicts -> seed the snapshot into indicator-state
//   2. Connect to /verdicts/stream -> receive deltas
//   3. Reconnect on disconnect with exponential backoff capped at 30s
//
// The plugin is loopback-only; if it's not loaded (ECONNREFUSED), this
// loop keeps retrying. Section K wires a 'plugin not installed' banner
// that surfaces the connection state to the UI; for now, silence.

import { definePlugin } from "nitro";
import {
  applyStuckVerdict,
  setStuckScanningEnabled,
  type StuckVerdictUpdate,
} from "../lib/indicator-state";
import {
  emitStuckEvent,
  type VerdictKind,
} from "../lib/stuck-detector-events";
import { buildServerOrigin, listConfiguredServers } from "../lib/server-registry";

const PLUGIN_URL = "http://127.0.0.1:4098";
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const SCANNING_POLL_INTERVAL_MS = 7_000;

// Track the last verdict per session so we only fan out actual
// transitions. Verdict deltas come in continuously (every retry
// re-emits a verdict); without dedup the drawer would fill with
// thousands of identical 'still in-progress' entries.
const lastVerdict = new Map<string, VerdictKind>();
let snapshotSeeded = false;

interface RawVerdict {
  sessionID?: string;
  verdict?: string;
  stuck_cause?: string | null;
  warnings?: string[];
  retry?: {
    attempt?: number;
    next_ms?: number | null;
    message?: string | null;
    overdue?: boolean;
  } | null;
  // Carried so we can resolve which portal serverId this session is
  // owned by (when the plugin knows) or fan out across every configured
  // server (when it doesn't). The plugin emits both fields on every
  // verdict; `directory` is currently advisory only - kept here to
  // future-proof a directory-based resolver if owner_instance_url
  // ever becomes unreliable.
  directory?: string | null;
  owner_instance_url?: string | null;
}

// Resolve which serverId(s) should host an indicator entry for this
// verdict's session when portal has none yet. Single source of truth
// for the seeding-fanout decision; intentionally read-mostly so it's
// safe to call per verdict.
function resolveSeedTargets(
  raw: RawVerdict,
): Array<{ serverId: string; port: number }> {
  let registered: ReturnType<typeof listConfiguredServers>;
  try {
    registered = listConfiguredServers();
  } catch {
    return [];
  }
  if (typeof raw.owner_instance_url === "string" && raw.owner_instance_url) {
    const target = raw.owner_instance_url.replace(/\/+$/, "");
    const hit = registered.find(
      (s) => buildServerOrigin(s.protocol, s.host, s.port) === target,
    );
    if (hit) return [{ serverId: hit.id, port: hit.port }];
    // owner_instance_url is set but unknown to this portal (e.g. a
    // worker on a host that isn't in our registry). Fall through to
    // fanout so the verdict still reaches whatever local view the
    // user has.
  }
  // Fan out to every configured server. The browser only renders the
  // entry under the server it's currently viewing (entries under other
  // servers are invisible to that browser). Bounded: ~configured-
  // servers x ~plugin-tracked-sessions (~2 x ~100 = ~200 entries x
  // ~500B = ~100KB; trivial). See ai-analysis-requests/
  // STUCK_SESSION_VISIBILITY.md for the rationale.
  return registered.map((s) => ({ serverId: s.id, port: s.port }));
}

function normalize(raw: RawVerdict): StuckVerdictUpdate | null {
  if (typeof raw.sessionID !== "string") return null;
  const verdict =
    raw.verdict === "idle" ||
    raw.verdict === "in-progress" ||
    raw.verdict === "stuck"
      ? raw.verdict
      : null;
  if (!verdict) return null;
  return {
    sessionID: raw.sessionID,
    verdict,
    stuck_cause:
      typeof raw.stuck_cause === "string" ? raw.stuck_cause : null,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((w): w is string => typeof w === "string")
      : [],
    retry: raw.retry
      ? {
          attempt:
            typeof raw.retry.attempt === "number" ? raw.retry.attempt : 0,
          next_ms:
            typeof raw.retry.next_ms === "number" ? raw.retry.next_ms : null,
          message:
            typeof raw.retry.message === "string" ? raw.retry.message : null,
          overdue: raw.retry.overdue === true,
        }
      : null,
    seedTargets: resolveSeedTargets(raw),
  };
}

async function fetchSnapshot(signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${PLUGIN_URL}/verdicts`, { signal });
    if (!res.ok) return;
    const body = (await res.json()) as Record<string, RawVerdict>;
    if (!body || typeof body !== "object") return;
    for (const v of Object.values(body)) {
      const update = normalize(v);
      if (update) {
        applyStuckVerdict(update);
        lastVerdict.set(update.sessionID, update.verdict);
      }
    }
    snapshotSeeded = true;
  } catch {
    /* plugin not reachable, leave indicator state empty */
  }
}

function maybeEmitTransition(update: StuckVerdictUpdate): void {
  // Skip until the initial snapshot is loaded so we don't synthesize
  // false 'X became stuck' events for sessions whose first verdict
  // delta arrives before the seed. After seeding, only true
  // transitions to/from 'stuck' surface to the drawer; idle <->
  // in-progress chatter would drown out the real events.
  if (!snapshotSeeded) {
    lastVerdict.set(update.sessionID, update.verdict);
    return;
  }
  const prev = lastVerdict.get(update.sessionID);
  lastVerdict.set(update.sessionID, update.verdict);
  if (prev === undefined) return;
  if (prev === update.verdict) return;
  const interesting = prev === "stuck" || update.verdict === "stuck";
  if (!interesting) return;
  emitStuckEvent({
    type: "verdict-transition",
    sessionID: update.sessionID,
    prev,
    next: update.verdict,
    stuck_cause: update.stuck_cause,
    at: Date.now(),
  });
}

async function streamVerdicts(signal: AbortSignal): Promise<void> {
  const res = await fetch(`${PLUGIN_URL}/verdicts/stream`, {
    signal,
    headers: { Accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`stuck-detector verdicts/stream returned ${res.status}`);
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
      let parsed: RawVerdict;
      try {
        parsed = JSON.parse(json) as RawVerdict;
      } catch {
        continue;
      }
      const update = normalize(parsed);
      if (update) {
        applyStuckVerdict(update);
        maybeEmitTransition(update);
      }
    }
  }
}

// Poll the plugin's /health for scanning_enabled and mirror it into the
// indicator-state flag. This is the authoritative path that converges
// portal even when the toggle was flipped out-of-band (curl) or persisted
// across a restart - the verdict stream sends no deltas while disabled, so
// it cannot carry the state itself.
async function pollScanningStateOnce(signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${PLUGIN_URL}/health`, { signal });
    if (!res.ok) return;
    const body = (await res.json()) as { scanning_enabled?: unknown };
    if (typeof body.scanning_enabled === "boolean") {
      setStuckScanningEnabled(body.scanning_enabled);
    }
  } catch {
    /* plugin unreachable; leave the flag as-is until it answers again */
  }
}

async function runScanningStatePoll(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await pollScanningStateOnce(signal);
    if (signal.aborted) return;
    await new Promise((resolve) =>
      setTimeout(resolve, SCANNING_POLL_INTERVAL_MS),
    );
  }
}

async function runLoop(signal: AbortSignal): Promise<void> {
  let delay = RECONNECT_BASE_DELAY_MS;
  while (!signal.aborted) {
    try {
      await pollScanningStateOnce(signal);
      await fetchSnapshot(signal);
      await streamVerdicts(signal);
      delay = RECONNECT_BASE_DELAY_MS;
    } catch (err) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("ECONNREFUSED")) {
        console.warn("[stuck-detector-client]", msg);
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
  void runScanningStatePoll(controller.signal);
  return {
    close() {
      controller.abort();
    },
  };
});
