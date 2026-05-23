import { defineHandler, getMethod, readBody, setResponseStatus } from "nitro/h3";

const PLUGIN_URL = "http://127.0.0.1:4098";

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    try {
      const r = await fetch(`${PLUGIN_URL}/config`);
      if (!r.ok) {
        setResponseStatus(event, r.status);
        return {
          ok: false,
          status: r.status,
          error:
            r.status === 404
              ? "Plugin doesn't expose /config yet - restart opencode-serve to load the latest plugin code."
              : `Plugin returned HTTP ${r.status}`,
        };
      }
      return { ok: true, config: await r.json() };
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
    const body = (await readBody(event)) as unknown;
    try {
      const r = await fetch(`${PLUGIN_URL}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) {
        setResponseStatus(event, r.status);
        return { ok: false, status: r.status, error: text };
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { ok: true, config: parsed };
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
