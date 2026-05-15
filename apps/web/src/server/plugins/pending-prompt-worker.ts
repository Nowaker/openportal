// Pending-prompt delivery worker.
//
// /prompt POSTs no longer call opencode synchronously. Instead they
// INSERT a row in `prompts` with status='pending' + the full opencode
// payload as JSON, then return 202 to the browser. This worker drains
// pending rows in the background, transitioning them to 'delivered'
// once opencode acknowledges (its promptAsync is itself near-instant)
// or 'failed' after MAX_DELIVERY_ATTEMPTS retries.
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
import { getOpencodeClient } from "../lib/opencode-client";
import {
  backoffMsForAttempts,
  listPendingPrompts,
  markPromptDelivered,
  markPromptFailed,
  recordDeliveryAttempt,
  MAX_DELIVERY_ATTEMPTS,
  type PromptRow,
  type PendingPayload,
} from "../lib/prompt-archive";

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

  let payload: PendingPayload;
  try {
    payload = JSON.parse(row.payload_json) as PendingPayload;
  } catch {
    markPromptFailed(row.id, "invalid payload_json");
    return;
  }

  try {
    const client = await getOpencodeClient(row.port);
    await client.session.promptAsync({
      path: { id: row.session_id },
      body: payload as unknown as Parameters<
        typeof client.session.promptAsync
      >[0]["body"],
    });
    markPromptDelivered(row.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordDeliveryAttempt(row.id, msg);
    if (row.attempts + 1 >= MAX_DELIVERY_ATTEMPTS) {
      markPromptFailed(row.id, `max attempts reached: ${msg}`);
    }
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
