// /api/opencode/{port}/session/{id}/prompt
//
// Async-by-default since the pending-prompt durability rework. Flow:
//
//   1. Parse + validate body.
//   2. INSERT a row in `prompts` with status='pending' + the full
//      opencode payload as JSON. After this returns the prompt is
//      durably stored - openportal can crash and a fresh process
//      will resume delivery on the next worker scan.
//   3. Wake the worker so it doesn't wait for the next interval
//      tick.
//   4. Return 202 to the browser. The composer clears immediately;
//      the worker drains the queue and transitions status to
//      'delivered' once opencode's promptAsync 204s (which is
//      itself near-instant - opencode just appends to the session
//      DB and serialises turns server-side).
//
// No "stuck-from-restart" preflight. Submit just submits. Special
// recovery actions (abort, unstuck, bump-overdue) only flow through
// the STUCK badge in the session title line.

import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";
import { invalidateMessagesCache } from "../../../../lib/messages-cache";
import { invalidateSessionsCache } from "../../../../lib/sessions-cache";
import { archivePrompt } from "../../../../lib/prompt-archive";
import { wakePendingPromptWorker } from "../../../../plugins/pending-prompt-worker";

const attachmentSchema = z.object({
  mime: z.string().min(1),
  filename: z.string().optional(),
  url: z.string().min(1),
});

const promptBodySchema = z.object({
  text: z.string().min(1),
  // archiveText: the compact form to persist in SQLite + show in
  // history. Diverges from `text` when the client expanded init
  // templates client-side (text gets the bodies, archive keeps the
  // "/template Name" references). Falls back to `text` when absent
  // so existing callers (chat composer, refire) are unchanged.
  archiveText: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
});

type AttachmentPart = {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
};

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const body = await parseBody(event, promptBodySchema);

  const fileParts: AttachmentPart[] = (body.attachments ?? []).map((a) => ({
    type: "file",
    mime: a.mime,
    filename: a.filename,
    url: a.url,
  }));

  // HARD RULE: never pre-generate opencode message/session/part IDs.
  // The `messageID` field on prompt_async is intentionally omitted so
  // opencode's canonical ULID-style generator stamps the user message.
  // Caller-supplied IDs break opencode's prompt-loop exit guard
  // (lex compare on lastUser.id vs lastAssistant.id) - see
  // ai-analysis-requests/STUCK_NO_DISPATCH_LEXICOGRAPHIC_ID_BUG.md and
  // the "Never pre-generate opencode-assigned IDs" section in AGENTS.md.
  const payload = {
    parts: [...fileParts, { type: "text" as const, text: body.text }],
    model: body.model,
    agent: body.agent,
    variant: body.variant,
  };

  const row = await archivePrompt({
    port,
    sessionId: id,
    rawText: body.archiveText ?? body.text,
    modelProvider: body.model?.providerID,
    modelId: body.model?.modelID,
    agent: body.agent,
    variant: body.variant,
    source: "prompt",
    attachmentsCount: body.attachments?.length ?? 0,
    status: "pending",
    payload,
  });

  if (!row) {
    throw new HTTPError("Prompt could not be durably stored; nothing was dispatched", { status: 503 });
  }

  wakePendingPromptWorker();
  invalidateMessagesCache(id);
    invalidateSessionsCache(port);
  return {
    accepted: true,
    id: row.id,
    status: "pending" as const,
  };
});
