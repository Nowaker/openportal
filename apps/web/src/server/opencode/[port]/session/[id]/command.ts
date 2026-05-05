import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { getOpencodeClientV2 } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";

const commandBodySchema = z.object({
  command: z.string().min(1),
  arguments: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  variant: z.string().optional(),
});

// Slash-command dispatch: a different endpoint from /prompt.async because
// opencode treats commands as first-class machinery (loads the prompt
// template, applies agent/model overrides from the command's frontmatter,
// fires command.executed events) NOT as plain text. Phase 1 of slash UX
// ran every "/foo bar" through /prompt and let the LLM interpret it; the
// command system never engaged. Phase 2 routes through this endpoint so
// command frontmatter actually takes effect.
//
// Returns the assistant message that opencode created. We don't proxy
// the body further - the chat view's SWR / SSE messages stream picks up
// the new message on its own.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const body = await parseBody(event, commandBodySchema);

  const client = getOpencodeClientV2(port);
  try {
    const result = await client.session.command({
      sessionID,
      command: body.command,
      arguments: body.arguments ?? "",
      agent: body.agent,
      model: body.model,
      variant: body.variant,
    });
    return { accepted: true, info: result.data?.info, parts: result.data?.parts };
  } catch (error) {
    throw new HTTPError(
      error instanceof Error ? error.message : "command failed",
      { status: 500 },
    );
  }
});
