import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { resolveOwner } from "../../../../lib/prompt-routing";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

interface CompactBody {
  providerID?: unknown;
  modelID?: unknown;
  auto?: unknown;
}

// Trigger opencode's session compaction (AI-summarised session
// preserving key context). Upstream endpoint is the v2 SDK route
// /session/<id>/summarize which REQUIRES { providerID, modelID }
// in the body. Forward those from the client (the session-info
// modal / hamburger menu reads them from the session's current
// model). Returns opencode's reply or an error envelope.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionId = parseRouteParam(event, "id");
  const incoming = (await readBody(event).catch(() => null)) as
    | CompactBody
    | null;
  const payload = {
    providerID: typeof incoming?.providerID === "string" ? incoming.providerID : "",
    modelID: typeof incoming?.modelID === "string" ? incoming.modelID : "",
    auto: incoming?.auto === true ? true : undefined,
  };
  if (!payload.providerID || !payload.modelID) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      status: 400,
      error: "providerID and modelID required (opencode /summarize spec).",
    };
  }
  // session.summarize/compact kicks off compaction work on a SPECIFIC
  // opencode instance (the one running the live runner). If we send it
  // to the user's selected active-server but the runner is on a
  // different cohort member, two parallel compaction jobs spawn for the
  // same session. Same bug class as P0 prompt-routing - resolve owner
  // first.
  const owner = await resolveOwner(sessionId);
  const targetPort = owner?.port ?? port;
  const res = await fetchOpencode(
    targetPort,
    `/session/${encodeURIComponent(sessionId)}/summarize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    setResponseStatus(event, res.status);
    return {
      ok: false,
      status: res.status,
      statusText: res.statusText,
      body,
    };
  }
  return {
    ok: true,
    body,
  };
});
