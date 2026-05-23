import { defineHandler } from "nitro/h3";

const PLUGIN_URL = "http://127.0.0.1:4098";
const PROBE_TIMEOUT_MS = 1_000;

export default defineHandler(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${PLUGIN_URL}/verdicts`, {
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
