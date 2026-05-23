import { defineHandler, readBody, setResponseStatus } from "nitro/h3";

const PLUGIN_URL = "http://127.0.0.1:4098";

interface RequestBody {
  sessionID?: unknown;
  cause?: unknown;
}

export default defineHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as RequestBody | null;
  const sessionID =
    typeof body?.sessionID === "string" ? body.sessionID : "";
  const cause = typeof body?.cause === "string" ? body.cause : undefined;
  if (!sessionID) {
    setResponseStatus(event, 400);
    return { ok: false, error: "sessionID required" };
  }
  try {
    const r = await fetch(
      `${PLUGIN_URL}/unstuck/${encodeURIComponent(sessionID)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cause ? JSON.stringify({ cause }) : "{}",
      },
    );
    const json = (await r.json().catch(() => null)) as unknown;
    if (!r.ok) {
      setResponseStatus(event, r.status);
      return { ok: false, status: r.status, body: json };
    }
    return { ok: true, body: json };
  } catch (err) {
    setResponseStatus(event, 503);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "stuck-detector plugin unreachable",
    };
  }
});
