import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import {
  getOpencodeClientV2,
  resolveSessionDirectory,
} from "../../../../lib/opencode-client";
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
  // HARD RULE: never pre-generate opencode message/session/part IDs.
  // The `messageID` field on /session/:id/command is intentionally
  // omitted so opencode stamps the resulting user message with its
  // canonical ULID-style ID. See AGENTS.md ("Never pre-generate
  // opencode-assigned IDs") and the prompt.ts sibling.
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
  }).catch((err) => {
    console.error("[prompt-archive] async failure:", err);
  });

  // Owner-aware dispatch: route to the cohort instance currently
  // running the session's runner, not blindly to `port` (the user's
  // active server). See prompt-routing.ts for the bug this fixes.
  const ownerTarget = await resolveOwner(sessionID);
  const targetPort = ownerTarget?.port ?? port;
  const client = await getOpencodeClientV2(targetPort);
  // Directory threading is required for the same reason as prompt.ts:
  // without it opencode's workspace-routing middleware resolves the
  // request to process.cwd() and the shell tool runs in the wrong cwd.
  // See resolveSessionDirectory's banner in opencode-client.ts.
  const directory = await resolveSessionDirectory(targetPort, sessionID);
  try {
    const result = await client.session.command({
      sessionID,
      directory,
      command: body.command,
      arguments: body.arguments ?? "",
      agent: body.agent,
      model: body.model,
      variant: body.variant,
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
