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
// /config is 704 bytes (bounded) vs /verdicts which is 11+ KB and grows
// with the stuck-session count. Both are equally good liveness probes;
// /config has the smaller payload + the smaller handler work.
const PROBE_PATH = "/config";

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
