import type { createOpencodeClient } from "@opencode-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { getPromptDb } from "./prompt-db";
import { markPromptDelivered, markPromptFailed, recordDeliveryAttempt, type PromptRow } from "./prompt-archive";

const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("file"), mime: z.string(), url: z.string(), filename: z.string().optional() }),
]);
const payloadSchema = z.object({
  parts: z.array(partSchema).min(1),
  model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
});
const dispatchSchema = z.object({
  baseline_json: z.string(), port: z.number(), directory: z.string().nullable(), receipt_id: z.string().nullable(),
  receipt_text_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
const rejectionSchema = z.object({ data: z.object({ possiblyAccepted: z.boolean().optional() }).optional() });
type Client = ReturnType<typeof createOpencodeClient>;
type Target = { readonly client: Client; readonly port: number; readonly directory?: string; readonly requiresReceipt?: boolean };

export function pendingDispatchTarget(id: string) {
  const row = getPromptDb().query("SELECT * FROM prompt_dispatch WHERE prompt_id = ?").get(id);
  return row ? dispatchSchema.parse(row) : undefined;
}

/** Once sent, only read-side reconciliation is safe, including after a crash. */
export async function deliverPendingPrompt(row: PromptRow, target: Target): Promise<void> {
  const parsed = z.string().transform((value, ctx) => {
    try { return JSON.parse(value); }
    catch { ctx.addIssue({ code: "custom", message: "invalid JSON" }); return z.NEVER; }
  }).pipe(payloadSchema).safeParse(row.payload_json);
  if (!parsed.success) {
    markPromptFailed(row.id, "invalid pending prompt payload");
    return;
  }
  const payload = parsed.data;
  const db = getPromptDb();
  const query = target.directory ? { directory: target.directory } : undefined;
  const readMessages = async () => {
    const result = await target.client.session.messages({
      path: { id: row.session_id }, query, signal: AbortSignal.timeout(15_000),
    });
    if (!result.response.ok || !result.data) throw new Error(`Message confirmation failed (HTTP ${result.response.status})`);
    return result.data;
  };

  try {
    let dispatch = pendingDispatchTarget(row.id);
    if (dispatch && (dispatch.port !== target.port || dispatch.directory !== (target.directory ?? null))) return;
    if (!dispatch) {
      const before = await readMessages();
      const baseline = before.map((message) => message.info.id);
      // The insert is also a cross-worker claim. A loser may reconcile but
      // cannot dispatch, even if two Portal processes share the archive.
      const claimed = db.prepare(
        "INSERT OR IGNORE INTO prompt_dispatch (prompt_id, baseline_json, port, directory) VALUES (?, ?, ?, ?)",
      ).run(row.id, JSON.stringify(baseline), target.port, target.directory ?? null);
      if (claimed.changes === 0) return;
      const result = await target.client.session.promptAsync({
        path: { id: row.session_id }, query, body: payload, signal: AbortSignal.timeout(90_000),
      });
      if (!result.response.ok) {
        const rejection = rejectionSchema.safeParse(result.error);
        const acceptance = rejection.success ? rejection.data.data?.possiblyAccepted : undefined;
        const safelyRejected = acceptance === false || (acceptance === undefined && [400, 401, 403, 404, 405, 422, 429].includes(result.response.status));
        if (safelyRejected) db.prepare("DELETE FROM prompt_dispatch WHERE prompt_id = ?").run(row.id);
        recordDeliveryAttempt(row.id, `OpenCode rejected prompt (HTTP ${result.response.status}). ${safelyRejected ? "Will retry." : "Acceptance uncertain; checking persistence without resending."}`);
        return;
      }
      const receipt = result.response.headers.get("X-Vibeterm-Message-ID");
      const digest = result.response.headers.get("X-Vibeterm-Receipt-Text-SHA256");
      if (receipt) db.prepare("UPDATE prompt_dispatch SET receipt_id = ?, receipt_text_sha256 = ? WHERE prompt_id = ?").run(receipt, digest, row.id);
      else if (!target.requiresReceipt && result.response.status === 204) {
        markPromptDelivered(row.id, null);
        return;
      }
      dispatch = pendingDispatchTarget(row.id);
    }
    if (!dispatch) return;
    if (!dispatch.receipt_id) {
      recordDeliveryAttempt(row.id, "Missing authoritative delivery receipt; confirmation is uncertain. Not resending; archived prompt is preserved.");
      return;
    }
    const baseline = new Set(z.array(z.string()).parse(JSON.parse(dispatch.baseline_json)));
    const expected = JSON.stringify(payload.parts);
    const matches = (await readMessages()).filter((message) => {
      if (message.info.role !== "user" || message.info.sessionID !== row.session_id || baseline.has(message.info.id)) return false;
      if (dispatch.receipt_id && message.info.id !== dispatch.receipt_id) return false;
      const parts = message.parts.flatMap((part) => {
        // OpenCode adds synthetic file-context parts; they are not user input.
        if (part.type === "text" && (part.synthetic || part.ignored)) return [];
        const parsedPart = partSchema.safeParse(part);
        return parsedPart.success ? [parsedPart.data] : [];
      });
      if (dispatch.receipt_text_sha256 !== null) {
        const part = parts[0];
        return parts.length === 1 && part?.type === "text"
          && createHash("sha256").update(part.text, "utf8").digest("hex") === dispatch.receipt_text_sha256;
      }
      return JSON.stringify(parts) === expected;
    });
    if (matches.length !== 1) {
      recordDeliveryAttempt(row.id, "Awaiting unambiguous persisted prompt confirmation; not resending. The archived prompt remains recoverable.");
      return;
    }
    const message = matches[0];
    if (!message) return;
    markPromptDelivered(row.id, message.info.id);
  } catch (error) {
    recordDeliveryAttempt(row.id, `${error instanceof Error ? error.message : String(error)}; awaiting confirmation before any resend`);
  }
}
