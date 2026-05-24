import { defineHandler, readBody, setResponseStatus } from "nitro/h3";
import { archivePrompt } from "../lib/prompt-archive";

// Bulletproof prompt history Phase 3: backend persistence for orphan
// localStorage entries. The /prompts UI's render-time reconciler POSTs
// here for any client-side entry that has lingered N seconds without
// landing in the backend archive. We archive with status='history-only'
// which marks the row as 'user-submitted but openportal never confirmed
// dispatch to opencode'. The pending-prompt-worker SKIPS history-only
// (it only scans status='pending'), so we don't accidentally re-dispatch
// a prompt the user already moved on from.
//
// Idempotency: callers should not retry on 2xx; the row is now in the
// archive. On 5xx the localStorage entry stays, the client retries later.

interface OrphanBody {
  sessionId?: unknown;
  port?: unknown;
  text?: unknown;
  submittedAt?: unknown;
  model?: unknown;
  agent?: unknown;
  variant?: unknown;
  attachmentsCount?: unknown;
  kind?: unknown;
}

export default defineHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as OrphanBody | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const port = typeof body?.port === "number" ? body.port : 0;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!sessionId || !port || !text) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      error: "sessionId + port + text required",
    };
  }
  let modelProvider: string | undefined;
  let modelId: string | undefined;
  if (
    body.model &&
    typeof body.model === "object" &&
    "providerID" in body.model &&
    "modelID" in body.model
  ) {
    const m = body.model as { providerID: unknown; modelID: unknown };
    if (typeof m.providerID === "string") modelProvider = m.providerID;
    if (typeof m.modelID === "string") modelId = m.modelID;
  }
  const agent = typeof body.agent === "string" ? body.agent : undefined;
  const variant = typeof body.variant === "string" ? body.variant : undefined;
  const attachmentsCount =
    typeof body.attachmentsCount === "number" ? body.attachmentsCount : 0;
  const kind = body.kind === "command" ? "command" : "prompt";
  const row = await archivePrompt({
    port,
    sessionId,
    rawText: text,
    modelProvider,
    modelId,
    agent,
    variant,
    source: kind === "command" ? "command" : "prompt",
    attachmentsCount,
    status: "history-only",
  });
  if (!row) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      error: "prompt filtered (empty / pure noise)",
    };
  }
  return {
    ok: true,
    id: row.id,
  };
});
