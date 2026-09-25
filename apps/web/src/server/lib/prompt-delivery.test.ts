import { afterEach, beforeEach, expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { archivePrompt, getPromptById } from "./prompt-archive";
import { closePromptDbForTesting } from "./prompt-db";
import { deliverPendingPrompt } from "./prompt-delivery";

let scratch: string;
let server: ReturnType<typeof Bun.serve>;
let posts: number;
let accepted: boolean;
let responseStatus: number;
let possiblyAccepted: boolean | undefined;
let persisted: boolean;
let unrelated: boolean;
let receipt: string | undefined;
let receiptDigest: string | undefined;
let persistedParts: readonly object[] | undefined;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "portal-delivery-"));
  process.env.OPENPORTAL_DB_PATH = join(scratch, "archive.db");
  closePromptDbForTesting();
  posts = 0;
  accepted = false;
  responseStatus = 204;
  possiblyAccepted = undefined;
  persisted = false;
  unrelated = false;
  receipt = "msg_new";
  receiptDigest = undefined;
  persistedParts = undefined;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.method === "POST") {
        posts++;
        if (responseStatus === 204) accepted = true;
        return new Response(responseStatus === 204 ? null : JSON.stringify({ name: "Error", data: { message: "launch refused", possiblyAccepted } }), {
          status: responseStatus,
          headers: { "Content-Type": "application/json", ...(receipt ? { "X-Vibeterm-Message-ID": receipt } : {}), ...(receiptDigest ? { "X-Vibeterm-Receipt-Text-SHA256": receiptDigest } : {}) },
        });
      }
  const messages = [{ info: { id: "msg_old", sessionID: "ses_fixture", role: "user" }, parts: [{ type: "text", text: "Implement durable prompt dispatch." }] }];
      if (accepted && persisted) messages.push({ info: { id: "msg_new", sessionID: "ses_fixture", role: "user" }, parts: [{ type: "text", text: "Implement durable prompt dispatch." }] });
      if (posts && unrelated) messages.push({ info: { id: "msg_other", sessionID: "ses_fixture", role: "user" }, parts: [{ type: "text", text: "Different concurrent prompt." }] });
      return Response.json(messages.map((message) => message.info.id === "msg_new" && persistedParts ? { ...message, parts: persistedParts } : message));
    },
  });
});

afterEach(() => {
  server.stop(true);
  closePromptDbForTesting();
  delete process.env.OPENPORTAL_DB_PATH;
  rmSync(scratch, { recursive: true, force: true });
});

async function fixture() {
  const row = await archivePrompt({
    port: server.port ?? 0, sessionId: "ses_fixture", projectPathOverride: scratch,
    source: "prompt", rawText: "Implement durable prompt dispatch.", status: "pending",
    payload: { parts: [{ type: "text", text: "Implement durable prompt dispatch." }] },
  });
  if (!row) throw new Error("fixture archive failed");
  const client = createOpencodeClient({ baseUrl: server.url.toString() });
  return { row, target: { client, directory: scratch, port: server.port ?? 0 } };
}

test("records SDK HTTP rejection instead of reporting delivered", async () => {
  const { row, target } = await fixture();
  responseStatus = 404;
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)).toMatchObject({ status: "pending", attempts: 1, opencode_message_id: null });
  expect(getPromptById(row.id)?.last_error).toContain("404");
});

test("requires a fresh matching persisted user, not a 204 or older identical prompt", async () => {
  const { row, target } = await fixture();
  unrelated = true;
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)?.status).toBe("pending");
  expect(getPromptById(row.id)?.last_error).toContain("confirmation");
});

test("reconciles after restart without sending an accepted prompt twice", async () => {
  const { row, target } = await fixture();
  await deliverPendingPrompt(row, target);
  closePromptDbForTesting();
  persisted = true;
  await deliverPendingPrompt(row, target);
  expect(posts).toBe(1);
  expect(getPromptById(row.id)).toMatchObject({ status: "delivered", opencode_message_id: "msg_new" });
});

test("preserves native successful 204 acceptance without claiming an exact receipt", async () => {
  const { row, target } = await fixture();
  persisted = true;
  receipt = undefined;
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)).toMatchObject({ status: "delivered", opencode_message_id: null });
});

test("does not trust a receipt naming an unrelated user message", async () => {
  const { row, target } = await fixture();
  receipt = "msg_other";
  persisted = true;
  unrelated = true;
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)?.status).toBe("pending");
});

test("retries a definitely rejected launch and then confirms persistence", async () => {
  const { row, target } = await fixture();
  responseStatus = 503;
  possiblyAccepted = false;
  await deliverPendingPrompt(row, target);
  responseStatus = 204;
  persisted = true;
  await deliverPendingPrompt(row, target);
  expect(posts).toBe(2);
  expect(getPromptById(row.id)?.status).toBe("delivered");
});

test("does not resend after an uncertain upstream error", async () => {
  const { row, target } = await fixture();
  responseStatus = 503;
  await deliverPendingPrompt(row, target);
  await deliverPendingPrompt(row, target);
  expect(posts).toBe(1);
  expect(getPromptById(row.id)?.status).toBe("pending");
});

test("requires the receipt explicitly promised by an improved Vibeterm backend", async () => {
  const { row, target } = await fixture();
  receipt = undefined;
  persisted = true;
  await deliverPendingPrompt(row, { ...target, requiresReceipt: true });
  await deliverPendingPrompt(row, { ...target, requiresReceipt: true });
  expect(getPromptById(row.id)?.status).toBe("pending");
  expect(posts).toBe(1);
});

test("does not reconcile a claim through a different proposed target", async () => {
  const { row, target } = await fixture();
  await deliverPendingPrompt(row, target);
  persisted = true;
  await deliverPendingPrompt(row, { ...target, port: target.port + 1 });
  expect(getPromptById(row.id)?.status).toBe("pending");
  expect(posts).toBe(1);
});

for (const text of ["inspect attachment", ""]) {
  test(`confirms normalized attachment receipt after restart (${text ? "text+file" : "file-only"})`, async () => {
    const normalized = "server-owned materialized attachment representation";
    const parts = [
      ...(text ? [{ type: "text", text }] : []),
      { type: "file", mime: "text/plain", filename: "fixture.txt", url: "data:text/plain;base64,Zml4dHVyZQ==" },
    ];
    const row = await archivePrompt({ port: server.port ?? 0, sessionId: "ses_fixture", projectPathOverride: scratch,
      source: "prompt", rawText: text, status: "pending", payload: { parts } });
    if (!row) throw new Error("fixture archive failed");
    const target = { client: createOpencodeClient({ baseUrl: server.url.toString() }), port: server.port ?? 0, requiresReceipt: true };
    receiptDigest = createHash("sha256").update(normalized, "utf8").digest("hex");
    persistedParts = [{ type: "text", text: normalized }];
    await deliverPendingPrompt(row, target);
    closePromptDbForTesting();
    persisted = true;
    await deliverPendingPrompt(row, target);
    expect(getPromptById(row.id)).toMatchObject({ status: "delivered", opencode_message_id: "msg_new" });
    expect(posts).toBe(1);
  });
}

test("ignored text cannot confirm an original-parts receipt", async () => {
  const { row, target } = await fixture();
  persisted = true;
  persistedParts = [{ type: "text", text: "Implement durable prompt dispatch.", ignored: true }];
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)?.status).toBe("pending");
});

test("ignored text cannot confirm a normalized receipt digest", async () => {
  const { row, target } = await fixture();
  persisted = true;
  const text = "Implement durable prompt dispatch.";
  persistedParts = [{ type: "text", text, ignored: true }];
  receiptDigest = createHash("sha256").update(text, "utf8").digest("hex");
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)?.status).toBe("pending");
});

test("a normalized digest cannot override receipt identity", async () => {
  const { row, target } = await fixture();
  persisted = true;
  receipt = "msg_other";
  receiptDigest = createHash("sha256").update("Implement durable prompt dispatch.", "utf8").digest("hex");
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)?.status).toBe("pending");
});

test("a normalized receipt cannot confirm a different content digest", async () => {
  const { row, target } = await fixture();
  persisted = true;
  receiptDigest = createHash("sha256").update("different normalized content", "utf8").digest("hex");
  await deliverPendingPrompt(row, target);
  expect(getPromptById(row.id)?.status).toBe("pending");
});
