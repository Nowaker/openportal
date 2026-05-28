import { defineHandler } from "nitro/h3";

const PLUGIN_URL = "http://127.0.0.1:4098";
// The plugin's Bun.serve shares the event loop with opencode's main work
// (LLM streaming, tool calls). Under load the plugin's HTTP handler can
// take 3+s to respond - measured against /verdicts and /workers
// (0.05s to 3+s, occasional >3s timeouts). 10s gives p99 headroom while
// failing fast on a genuinely dead plugin (ECONNREFUSED is instant
// regardless of timeout). Pre-fix this was 1_000 ms which surfaced the
// banner permanently on busy opencodes.
const PROBE_TIMEOUT_MS = 10_000;
// /health is the dedicated liveness endpoint: instant static handler
// (no DB lookup, no verdicts-map iteration, no scan), 43-byte response
// ({ok:true,ts:<iso>}). It's defense-in-depth against a saturated host
// opencode event loop - even when /config and /verdicts handlers can't
// slip in between blocking LLM/tool-call work, /health's near-zero
// handler cost is the most likely to make it through. Landed in
// opencode-tools alongside the #25 portal-side timeout fix. Pre-fix
// this was /config (704 B but still touches the config map);
// pre-pre-fix it was /verdicts (11+ KB and grows with stuck-session
// count). Each step further reduces the work the plugin has to do to
// answer "are you alive?".
const PROBE_PATH = "/health";

export default defineHandler(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${PLUGIN_URL}${PROBE_PATH}`, {
      signal: controller.signal,
    });
    return { connected: r.ok, status: r.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      error: msg.includes("ECONNREFUSED")
        ? "ECONNREFUSED"
        : msg.includes("aborted")
          ? "timeout"
          : msg,
    };
  } finally {
    clearTimeout(timer);
  }
});
