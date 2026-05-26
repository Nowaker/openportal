// Per-session verdict proxy.
//
// The plugin's authoritative aggregator (opencode-tools 65fbbf2 +
// 22736c4) exposes GET /verdicts/<sid> which carries the live ownership
// + status info for a session - the only thing in the system that
// knows WHICH opencode instance is currently dispatching this session
// across a multi-instance cohort.
//
// This proxy makes the verdict reachable from the browser via
// /api/stuck-detector/verdict/<sid> so the Session Info modal can
// surface the owner instance + verdict status + warnings to the user.
//
// 404 when the plugin has no verdict cached for this session (idle
// sessions or sessions outside the current cohort). The plugin's
// 'authoritative-only' rule means the absence of a verdict means we
// genuinely don't know; don't fabricate one.

import { defineHandler, setResponseStatus } from "nitro/h3";
import { parseRouteParam } from "../../lib/validation";

const PLUGIN_URL = "http://127.0.0.1:4098";
const FETCH_TIMEOUT_MS = 10_000;

export default defineHandler(async (event) => {
  const id = parseRouteParam(event, "id");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(
      `${PLUGIN_URL}/verdicts/${encodeURIComponent(id)}`,
      { signal: ctrl.signal },
    );
    if (r.status === 404) {
      setResponseStatus(event, 404);
      return { error: "no verdict", connected: true };
    }
    if (!r.ok) {
      setResponseStatus(event, 502);
      return { error: `plugin ${r.status}`, connected: true };
    }
    const body = await r.json().catch(() => null);
    if (!body || typeof body !== "object") {
      setResponseStatus(event, 502);
      return { error: "invalid plugin response", connected: true };
    }
    return body;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setResponseStatus(event, 503);
    return {
      error: msg.includes("ECONNREFUSED")
        ? "ECONNREFUSED"
        : msg.includes("aborted")
          ? "timeout"
          : msg,
      connected: false,
    };
  } finally {
    clearTimeout(timer);
  }
});
