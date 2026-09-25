import { defineHandler, readBody } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import { relayVibetermQuestionResponse } from "../../../../lib/vibeterm-questions";

// Delivered by vibeterm-api through the Vibeterm pane's own submit helper.
// The body is forwarded as-is; vibeterm-api validates it against the
// request's questions, which this proxy does not know.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const requestId = parseRouteParam(event, "requestId");
  const body = await readBody(event);
  return relayVibetermQuestionResponse(
    await fetchOpencode(
      port,
      `/vibeterm/question/${encodeURIComponent(requestId)}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      },
    ),
  );
});
