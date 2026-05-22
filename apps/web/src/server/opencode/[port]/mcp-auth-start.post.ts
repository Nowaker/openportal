import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { fetchOpencode } from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";

interface StartBody {
  name?: unknown;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const body = (await readBody(event).catch(() => null)) as StartBody | null;
  const name = typeof body?.name === "string" ? body.name : "";
  if (!name) {
    setResponseStatus(event, 400);
    return { ok: false, error: "name required" };
  }
  const res = await fetchOpencode(
    port,
    `/mcp/${encodeURIComponent(name)}/auth`,
    { method: "POST" },
  );
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    setResponseStatus(event, res.status);
    return { ok: false, status: res.status, body: json };
  }
  return { ok: true, ...((json as object) ?? {}) };
});
