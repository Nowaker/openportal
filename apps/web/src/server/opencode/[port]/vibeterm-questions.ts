import { defineHandler, getQuery } from "nitro/h3";
import { fetchOpencode } from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";
import { relayVibetermQuestionResponse } from "../../lib/vibeterm-questions";

// vibeterm's async questions (questions.db), which opencode's /question
// never lists - see opencode-tools vibeterm-api/README.md. Status and body
// are relayed verbatim, except a server without the routes (below).
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(getQuery(event))) {
    if (typeof value === "string") query.set(key, value);
  }
  const search = query.size > 0 ? `?${query}` : "";
  const upstream = await fetchOpencode(port, `/vibeterm/question${search}`);
  // A server without the routes - a vibeterm-api predating them (404), or one
  // with no store wired (503) - is an ordinary case, not an error: every
  // question card asks. Relayed, it would log a failed request in the browser
  // console per card, so it is answered `null`, which the client reads as
  // unsupported exactly as it read the status.
  if (upstream.status === 404 || upstream.status === 503) {
    return new Response("null", { headers: { "Content-Type": "application/json" } });
  }
  return relayVibetermQuestionResponse(upstream);
});
