import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { fetchOpencode } from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";

interface CallbackBody {
  name?: unknown;
  code?: unknown;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const body = (await readBody(event).catch(() => null)) as CallbackBody | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const code = typeof body?.code === "string" ? body.code : "";
  if (!name || !code) {
    setResponseStatus(event, 400);
    return { ok: false, error: "name and code required" };
  }
  const res = await fetchOpencode(
    port,
    `/mcp/${encodeURIComponent(name)}/auth/callback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
  );
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    setResponseStatus(event, res.status);
    return { ok: false, status: res.status, body: json };
  }
  return { ok: true, body: json };
});
