import { definePlugin } from "nitro";
import { networkInterfaces } from "node:os";

import { applyDbInFlight } from "../lib/indicator-state";
import {
  isOpencodeDbAvailable,
  queryInFlightSessionIds,
} from "../lib/opencode-db";
import { listConfiguredServers } from "../lib/server-registry";

// DB-derived in-progress poller. Portal's `busy` indicator is normally fed
// by opencode's /event SSE (via indicator-broadcaster), but that stream -
// and /session/status - starve when opencode's event loop is pegged under
// heavy multi-session load, leaving active sessions falsely idle/green.
// This poller reads opencode's shared DB directly (always current) and
// marks sessions with an unfinished assistant turn as in-flight, folded
// into the same indicator-state the SSE path writes. Works identically for
// the frontend's polling and SSE modes (both read indicator-state).

const POLL_INTERVAL_MS = 3_000;

// A session counts as in-progress if its unfinished assistant turn was
// written within this window. Generous on purpose: a session stalled
// between steps or waiting on a slow / rate-limited LLM call writes nothing
// to the DB meanwhile, and must not flip to idle. Still bounded so a
// crashed turn (time.completed null forever) ages out instead of showing
// in-progress permanently - portal does not decide stuck; the
// stuck-detector overlays that verdict separately.
const IN_FLIGHT_WINDOW_MS = 10 * 60_000;

function localAddresses(): Set<string> {
  const out = new Set<string>(["127.0.0.1", "::1", "localhost"]);
  try {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) out.add(a.address);
    }
  } catch {
    /* networkInterfaces unavailable; the loopback defaults suffice */
  }
  return out;
}

// Only opencode servers that share THIS host's DB get DB-derived status; a
// remote opencode keeps its own DB we cannot read from here.
function localTargets(): Array<{ serverId: string; port: number }> {
  const local = localAddresses();
  let servers: ReturnType<typeof listConfiguredServers>;
  try {
    servers = listConfiguredServers();
  } catch {
    return [];
  }
  return servers
    .filter((s) => local.has(s.host))
    .map((s) => ({ serverId: s.id, port: s.port }));
}

function tick(): void {
  if (!isOpencodeDbAvailable()) return;
  const targets = localTargets();
  if (targets.length === 0) return;
  const inFlight = queryInFlightSessionIds(IN_FLIGHT_WINDOW_MS);
  applyDbInFlight(inFlight, targets);
}

export default definePlugin(() => {
  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.warn(
        "[db-status-poller] tick threw:",
        err instanceof Error ? err.message : err,
      );
    }
  }, POLL_INTERVAL_MS);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }
  tick();
});
