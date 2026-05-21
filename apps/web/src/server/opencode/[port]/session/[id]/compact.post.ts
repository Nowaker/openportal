import { defineHandler, setResponseStatus } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

// Trigger opencode's session compaction (AI-summarised session
// preserving key context). Upstream endpoint is the v1 SDK route
// /session/<id>/summarize. Returns whatever opencode returns (the v1
// shape is `{ message: { id, role: "assistant", ... } }` of the
// freshly-created compaction message, or an error envelope).
//
// Surfaced from the title-bar hamburger menu as "Compact session" so
// the user can pre-empt context-overflow before opencode auto-fires
// the compaction itself.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionId = parseRouteParam(event, "id");
  const res = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(sessionId)}/summarize`,
    { method: "POST" },
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
