// Pending-prompt delivery worker.
//
// /prompt POSTs no longer call opencode synchronously. Instead they
// INSERT a row in `prompts` with status='pending' + the full opencode
// payload as JSON, then return 202 to the browser. This worker drains
// pending rows in the background, transitioning them to 'delivered'
// once native OpenCode accepts, or a supplied Vibeterm receipt is verified.
//
// Retry policy: hunt opencode forever (per user mandate). The worker
// retries definitive rejections indefinitely with exponential backoff
// capped at 60s; uncertain dispatches are only reconciled, never resent.
// There is NO retry count limit - a prompt sits in
// pending state until opencode accepts it, or until the user
// explicitly cancels it. Rows only transition to 'failed' on
// structural problems we can never recover from (missing port,
// invalid payload_json) - never on transient opencode unreachability.
//
// Key reliability guarantee: every pending row survives openportal
// restart. On boot the worker resumes the queue automatically; nothing
// is lost. The browser can clear its composer field the moment Portal
// 202s the submission - the prompt has crossed into Portal's durable
// store and Portal owns delivery from there.
//
// Wakeup: /prompt calls wakePendingPromptWorker() after each insert so
// new submissions don't wait for the next interval tick. The interval
// handles late-recoveries (Portal up but opencode briefly down, etc.).

import { definePlugin } from "nitro";
import {
  getOpencodeClient,
  resolveSessionDirectory,
} from "../lib/opencode-client";
import { resolveOwner } from "../lib/prompt-routing";
import {
  backoffMsForAttempts,
  listPendingPrompts,
  markPromptFailed,
  recordDeliveryAttempt,
  type PromptRow,
} from "../lib/prompt-archive";
import { deliverPendingPrompt, pendingDispatchTarget } from "../lib/prompt-delivery";
import { requiresPromptReceipt } from "../lib/prompt-delivery-capability";

const SCAN_INTERVAL_MS = 5_000;

let scanInFlight = false;
let wakeupRequested = false;

async function deliverOne(row: PromptRow): Promise<void> {
  if (row.port == null || !row.payload_json) {
    markPromptFailed(row.id, "missing port or payload_json");
    return;
  }
  if (row.last_attempt_at !== null) {
    const elapsed = Date.now() - row.last_attempt_at;
    const required = backoffMsForAttempts(row.attempts);
    if (elapsed < required) return;
  }

  try {
    // Cross-instance owner resolution. Without this, the worker dispatches
    // to row.port (the active server the user picked at archive time)
    // even when the session's live runner is on a DIFFERENT instance in
    // the same cohort - opencode then spawns a second runner. See
    // prompt-routing.ts header for the full bug description.
    const dispatched = pendingDispatchTarget(row.id);
    const owner = dispatched ? undefined : await resolveOwner(row.session_id);
    const targetPort = dispatched?.port ?? owner?.port ?? row.port;
    const client = await getOpencodeClient(targetPort);
    if (owner && targetPort !== row.port) {
      console.log(
        `[pending-prompt-worker] sid=${row.session_id} rerouted from ` +
          `archived port ${row.port} to owner ${owner.host}:${owner.port}`,
      );
    }
    // resolveSessionDirectory is what fixes the bash-tool-cwd bug. See
    // the helper's banner comment in opencode-client.ts for the full
    // explanation of why every session-scoped POST must carry the
    // directory. Best-effort: on miss we fall through with no directory
    // and opencode resolves it via process.cwd() - which is the
    // pre-fix behaviour, so worst case the bug just doesn't get fixed
    // for this one delivery.
    const directory = dispatched ? dispatched.directory ?? undefined : await resolveSessionDirectory(
      targetPort,
      row.session_id,
    );
    const requiresReceipt = dispatched ? true : await requiresPromptReceipt(targetPort);
    await deliverPendingPrompt(row, { client, port: targetPort, directory, requiresReceipt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordDeliveryAttempt(row.id, msg);
  }
}

async function scan(): Promise<void> {
  if (scanInFlight) {
    wakeupRequested = true;
    return;
  }
  scanInFlight = true;
  try {
    do {
      wakeupRequested = false;
      const pending = listPendingPrompts(50);
      if (pending.length === 0) break;
      for (const row of pending) {
        await deliverOne(row);
      }
    } while (wakeupRequested);
  } finally {
    scanInFlight = false;
  }
}

export function wakePendingPromptWorker(): void {
  void scan();
}

export default definePlugin(() => {
  console.log("[pending-prompt-worker] starting");
  void scan();
  const timer = setInterval(() => void scan(), SCAN_INTERVAL_MS);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }
});
