import { defineHandler, getQuery } from "nitro/h3";
import { fetchOpencode } from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";
import { relayVibetermQuestionResponse } from "../../lib/vibeterm-questions";

// vibeterm's async questions (questions.db), which opencode's /question
// never lists - see opencode-tools vibeterm-api/README.md. Status and body
// are relayed verbatim: the client tells "this server has no async
// questions" (404 NotFoundError, no route) from "no such request"
// (404 QuestionNotFoundError) by the body's name.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(getQuery(event))) {
    if (typeof value === "string") query.set(key, value);
  }
  const search = query.size > 0 ? `?${query}` : "";
  return relayVibetermQuestionResponse(
    await fetchOpencode(port, `/vibeterm/question${search}`),
  );
});
