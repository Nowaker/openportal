// /api/opencode/{port}/session/{id}/prompt
//
// Async-by-default since the pending-prompt durability rework. Flow:
//
//   1. Parse + validate body.
//   2. Run the cheap stuck-from-restart preflight so the browser
//      gets a recoveredFromRestart signal for the recovery toast.
//      The cleanup-stuck-session call that used to live here is
//      gone - the worker retries failed deliveries with backoff,
//      which subsumes the cleanup case (a zombie session would
//      cause promptAsync to fail, the worker retries, eventually
//      opencode's own state self-heals).
//   3. INSERT a row in `prompts` with status='pending' + the full
//      opencode payload as JSON. After this returns the prompt is
//      durably stored - openportal can crash and a fresh process
//      will resume delivery on the next worker scan.
//   4. Wake the worker so it doesn't wait for the next interval
//      tick.
//   5. Return 202 to the browser. The composer clears immediately;
//      the worker drains the queue and transitions status to
//      'delivered' once opencode's promptAsync 204s (which is
//      itself near-instant - opencode just appends to the session
//      DB and serialises turns server-side).

import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";
import { invalidateMessagesCache } from "../../../../lib/messages-cache";
import { archivePrompt } from "../../../../lib/prompt-archive";
import { detectStuckFromRestart } from "../../../../lib/stuck-detector-bridge";
import { wakePendingPromptWorker } from "../../../../plugins/pending-prompt-worker";

const attachmentSchema = z.object({
  mime: z.string().min(1),
  filename: z.string().optional(),
  url: z.string().min(1),
});

const promptBodySchema = z.object({
  text: z.string().min(1),
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

  const payload = {
    parts: [...fileParts, { type: "text" as const, text: body.text }],
    model: body.model,
    agent: body.agent,
    variant: body.variant,
  };

  let recoveredFromRestart = false;
  if (await detectStuckFromRestart(port, id)) {
    try {
      const client = await getOpencodeClient(port);
      await client.session.abort({ path: { id } });
      recoveredFromRestart = true;
    } catch {
      /* abort may noop if opencode already reaped the dead row; fine */
    }
  }

  const row = await archivePrompt({
    port,
    sessionId: id,
    rawText: body.text,
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
    // Prompt was filtered (empty / pure-noise per prompt-filter).
    // Fall back to direct synchronous delivery so we never silently
    // drop a user's submission just because it doesn't pass the
    // archive filter.
    try {
      const client = await getOpencodeClient(port);
      await client.session.promptAsync({
        path: { id },
        body: payload as unknown as Parameters<
          typeof client.session.promptAsync
        >[0]["body"],
      });
      invalidateMessagesCache(id);
      return {
        accepted: true,
        status: "delivered" as const,
        recoveredFromRestart,
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
  return {
    accepted: true,
    id: row.id,
    status: "pending" as const,
    recoveredFromRestart,
  };
});
