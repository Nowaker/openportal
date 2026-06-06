import { defineHandler, getMethod, readBody, setResponseStatus } from "nitro/h3";
import { setStuckScanningEnabled } from "../lib/indicator-state";

// Proxy to the stuck-detector plugin's GET/PUT /scanning endpoint.
// The plugin runs on 127.0.0.1:4098 (same loopback bind as every other
// plugin endpoint). When the plugin is unreachable we return 503 with a
// human-readable `error` so the settings UI can deactivate its section
// instead of showing a generic spinner. When the plugin is up but
// doesn't yet expose /scanning (older opencode-tools build), we return
// 404 with a "restart opencode-serve" hint, mirroring config.ts.

const PLUGIN_URL = "http://127.0.0.1:4098";

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    try {
      const r = await fetch(`${PLUGIN_URL}/scanning`);
      if (!r.ok) {
        setResponseStatus(event, r.status);
        return {
          ok: false,
          status: r.status,
          error:
            r.status === 404
              ? "Plugin doesn't expose /scanning yet - restart opencode-serve to load the latest plugin code."
              : `Plugin returned HTTP ${r.status}`,
        };
      }
      const body = (await r.json()) as { enabled?: unknown };
      const enabled = body.enabled === true;
      setStuckScanningEnabled(enabled);
      return { ok: true, enabled };
    } catch (err) {
      setResponseStatus(event, 503);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: msg.includes("ECONNREFUSED")
          ? "Plugin unreachable (ECONNREFUSED) - is opencode-serve running with the plugin loaded?"
          : msg,
      };
    }
  }
  if (method === "PUT") {
    const body = (await readBody(event)) as { enabled?: unknown };
    if (typeof body?.enabled !== "boolean") {
      setResponseStatus(event, 400);
      return { ok: false, error: "Body must be { enabled: boolean }" };
    }
    try {
      const r = await fetch(`${PLUGIN_URL}/scanning`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: body.enabled }),
      });
      const text = await r.text();
      if (!r.ok) {
        setResponseStatus(event, r.status);
        return { ok: false, status: r.status, error: text };
      }
      let parsed: { enabled?: unknown } = {};
      try {
        parsed = JSON.parse(text) as { enabled?: unknown };
      } catch {
        // plugin returned non-JSON; treat parsed.enabled as undefined
      }
      const enabled = parsed.enabled === true;
      setStuckScanningEnabled(enabled);
      return { ok: true, enabled };
    } catch (err) {
      setResponseStatus(event, 503);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  setResponseStatus(event, 405);
  return { ok: false, error: "Method not allowed" };
});
