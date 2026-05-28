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
  getOpencodeClient,
  resolveSessionDirectory,
} from "../../../../lib/opencode-client";
import { resolveOwner } from "../../../../lib/prompt-routing";
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

  // Smart-dedup: pre-generate the opencode messageID portal-side so the
  // user-message dedup in messages.ts can match by ID instead of fuzzy
  // text. opencode accepts an optional messageID on prompt_async; when
  // we supply it, opencode stamps the resulting user message with that
  // exact ID. Stored on the archive row + included in payload_json so
  // the pending-prompt-worker retries with the same ID (idempotent).
  //
  // ============================================================
  // WHY THE `f` PREFIX (DO NOT REMOVE - BUG WORKAROUND)
  // ============================================================
  //
  // opencode's prompt loop in
  //   packages/opencode/src/session/prompt.ts (≈line 1268-1276)
  // has an exit guard that decides "has this user message already
  // been answered?" by string-comparing the latest user-message ID
  // against the latest assistant-message ID:
  //
  //   if (
  //     lastAssistant?.finish &&
  //     !["tool-calls"].includes(lastAssistant.finish) &&
  //     !hasToolCalls &&
  //     lastUser.id < lastAssistant.id   // ← LEX COMPARE on strings
  //   ) {
  //     yield* slog.info("exiting loop")
  //     break
  //   }
  //
  // The lex compare is a proxy for `time.created` ordering. It works
  // ONLY when both IDs are time-sortable. opencode's own IDs are
  // ULID-style with a hex timestamp prefix (currently `e6...` in
  // 2026). Any caller-supplied messageID that sorts lex-BELOW
  // opencode's last assistant ID fires the guard as TRUE on the
  // SECOND-AND-LATER prompt of any session → loop exits at step=0
  // → no LLM call → user message silently swallowed →
  // stuck-detector classifies as `verdict=stuck, cause=no-dispatch`.
  //
  // crypto.randomUUID() returns a uniformly-distributed hex string.
  // 15 of 16 first chars (`0`-`e`) sort BELOW opencode's `e6...`
  // prefix. Without this `f` prefix, ~89% of prompts to existing
  // sessions get silently swallowed. The first prompt of a fresh
  // session always works (no prior assistant → guard's
  // `lastAssistant?.finish` short-circuits) which is why this bug
  // hides behind "new sessions seem fine".
  //
  // Prefix `f` is the ONLY hex char that ALWAYS sorts GREATER than
  // any opencode-generated ID currently in the wild. By forcing
  // every portal-generated messageID to start with `f`, the loop
  // guard sees `lastUser.id > lastAssistant.id` and continues
  // normally. Dispatch works, LLM gets called, assistant message
  // is created, session unsticks.
  //
  // FULL FORENSIC ANALYSIS:
  //   ai-analysis-requests/STUCK_NO_DISPATCH_LEXICOGRAPHIC_ID_BUG.md
  //
  // WHEN TO REMOVE THIS PREFIX:
  // - When opencode replaces the lex compare with a numeric
  //   `lastUser.time.created < lastAssistant.time.created` check.
  //   That fix is invariant under any ID format. Confirm by
  //   reading the current `packages/opencode/src/session/prompt.ts`
  //   loop body before reverting this workaround.
  //
  // IF OPENCODE'S ID TIMESTAMP PREFIX EVER ADVANCES PAST `f...`:
  // - This wouldn't happen for many years (opencode's prefix
  //   currently sits at `e6` and only climbs as wall-clock advances
  //   through ULID timestamp space).
  // - When it does, this `f` prefix will START sorting BELOW
  //   opencode's IDs and the bug returns.
  // - At that point, swap the literal `f` for something higher in
  //   ASCII sort order than opencode's new prefix (e.g. `z`,
  //   uppercase letters do NOT work — uppercase ASCII sorts below
  //   lowercase). Verify opencode's `messageID` schema accepts the
  //   chosen char before shipping.
  //
  // PATTERN MUST MATCH `command.ts` SIBLING:
  // - The same workaround exists in command.ts. If you touch this,
  //   touch that. Both files send caller-supplied messageIDs to
  //   opencode and both hit the same loop guard.
  // ============================================================
  const opencodeMessageId = `msg_f${crypto.randomUUID().replace(/-/g, "").slice(0, 31)}`;

  const payload = {
    parts: [...fileParts, { type: "text" as const, text: body.text }],
    model: body.model,
    agent: body.agent,
    variant: body.variant,
    messageID: opencodeMessageId,
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
    opencodeMessageId,
  });

  if (!row) {
    // Prompt was filtered (empty / pure-noise per prompt-filter).
    // Fall back to direct synchronous delivery so we never silently
    // drop a user's submission just because it doesn't pass the
    // archive filter.
    try {
      // Owner-aware dispatch: route to the cohort instance currently
      // running the session's runner, not blindly to `port` (the user's
      // active server). See prompt-routing.ts for the bug this fixes.
      const owner = await resolveOwner(id);
      const targetPort = owner?.port ?? port;
      const client = await getOpencodeClient(targetPort);
      const directory = await resolveSessionDirectory(targetPort, id);
      await client.session.promptAsync({
        path: { id },
        query: directory ? { directory } : undefined,
        body: payload as unknown as Parameters<
          typeof client.session.promptAsync
        >[0]["body"],
      });
      invalidateMessagesCache(id);
        invalidateSessionsCache(port);
      return {
        accepted: true,
        status: "delivered" as const,
      };
    } catch (error) {
      throw new HTTPError(
        error instanceof Error ? error.message : "Prompt failed",
        { status: 500 },
      );
    }
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
