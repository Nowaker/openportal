import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { getOpencodeClientV2 } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";
import { invalidateMessagesCache } from "../../../../lib/messages-cache";
import { invalidateSessionsCache } from "../../../../lib/sessions-cache";
import { resolveOwner } from "../../../../lib/prompt-routing";
import { archivePrompt } from "../../../../lib/prompt-archive";

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

  // Reconstruct what the user typed for the archive. Slash commands
  // arrive as {command, arguments}; the original keystroke was
  // `/<command> <arguments>`. Fire-and-forget; archive failure must
  // not block dispatch.
  const reconstructedText = body.arguments
    ? `/${body.command} ${body.arguments}`
    : `/${body.command}`;
  // Smart-dedup: pre-generate messageID so the user message opencode
  // creates carries the same ID we store on the archive row. Without
  // this, slash-command expansion would emit text bearing no
  // resemblance to '/foo bar' and the text-based dedup misses it.
  const messageID = `msg_${randomUUID().replace(/-/g, "")}`;
  void archivePrompt({
    port,
    sessionId: sessionID,
    rawText: reconstructedText,
    modelProvider: undefined,
    modelId: body.model,
    agent: body.agent,
    variant: body.variant,
    source: "command",
    attachmentsCount: 0,
    opencodeMessageId,
  }).catch((err) => {
    console.error("[prompt-archive] async failure:", err);
  });

  // Pre-generate the messageID portal-side so messages.ts dedup can
  // correlate the archived row with opencode's emitted user message
  // (which carries an expanded template, NOT the literal '/foo bar').
  const opencodeMessageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;

  // Owner-aware dispatch: route to the cohort instance currently
  // running the session's runner, not blindly to `port` (the user's
  // active server). See prompt-routing.ts for the bug this fixes.
  const ownerTarget = await resolveOwner(sessionID);
  const targetPort = ownerTarget?.port ?? port;
  const client = await getOpencodeClientV2(targetPort);
  try {
    const result = await client.session.command({
      sessionID,
      command: body.command,
      arguments: body.arguments ?? "",
      agent: body.agent,
      model: body.model,
      variant: body.variant,
      messageID: opencodeMessageId,
    });
    invalidateMessagesCache(sessionID);
    invalidateSessionsCache(port);
    return { accepted: true, info: result.data?.info, parts: result.data?.parts };
  } catch (error) {
    throw new HTTPError(
      error instanceof Error ? error.message : "command failed",
      { status: 500 },
    );
  }
});
