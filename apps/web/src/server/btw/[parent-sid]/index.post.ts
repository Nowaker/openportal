// POST /api/btw/<parent-sid>
//
// Orchestrates a /btw side-question: writes the question synthetic-
// message immediately (so the user sees it in chat log within one
// paint), then in the BACKGROUND forks the parent at HEAD, renames the
// fork to [btw#N] <truncated-question>, sends the question with a
// tool-disable instruction, polls for the assistant's completed
// response, archives the fork, and writes the answer synthetic-message.
// The response returns immediately after the question is written; the
// answer lands in the chat log later via the messages-merge path.
//
// Per AI_TODO #138: the fork is hidden from the sidebar via the
// `[btw#` title prefix (filtered client-side in useSessions). It also
// gets archived after completion as a belt-and-suspenders.
//
// Tool-disable: opencode's session.status doesn't accept "no tools"
// directly; v1 ships a strong system-prompt addendum and relies on
// the model's compliance. A stricter server-side enforcement (custom
// agent with empty tool set, or opencode-side flag) is a follow-up.

import { defineHandler } from "nitro/h3";
import { z } from "zod/v4";
import { fetchOpencode } from "../../lib/opencode-client";
import { parseBody, parseRouteParam } from "../../lib/validation";
import {
  insertSynthetic,
  nextBtwIndex,
} from "../../lib/synthetic-messages";

const bodySchema = z.object({
  question: z.string().min(1),
  port: z.number().int().positive(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
});

const BTW_INSTRUCTION =
  "[BTW: side question - answer briefly in ONE response. Do NOT call any tools. Do NOT read or modify any files. Do NOT promise follow-up actions. Answer only from what's already in the conversation context.]";
const POLL_INTERVAL_MS = 1_500;
const MAX_WAIT_MS = 5 * 60 * 1_000;
const TITLE_MAX_LEN = 60;

interface OpencodeMessageRow {
  info: {
    id: string;
    role: string;
    time?: { completed?: number | null };
  };
  parts: Array<{ type: string; text?: string }>;
}

async function runBtwOrchestration(
  port: number,
  parentSessionId: string,
  btwIndex: number,
  question: string,
  model: { providerID: string; modelID: string } | undefined,
): Promise<void> {
  // 1. Fork the parent at HEAD (no messageID = tip).
  const forkRes = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(parentSessionId)}/fork`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!forkRes.ok) {
    throw new Error(`fork failed: ${forkRes.status} ${await forkRes.text()}`);
  }
  const forkBody = (await forkRes.json()) as { id: string };
  const forkSessionId = forkBody.id;

  // 2. Rename fork to [btw#N] <truncated question>.
  const oneLine = question.replace(/\s+/g, " ").trim();
  const truncated = oneLine.slice(0, TITLE_MAX_LEN);
  const ellipsis = oneLine.length > TITLE_MAX_LEN ? "..." : "";
  const forkTitle = `[btw#${btwIndex}] ${truncated}${ellipsis}`;
  await fetchOpencode(
    port,
    `/session/${encodeURIComponent(forkSessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: forkTitle }),
    },
  ).catch((err) => {
    console.warn("[btw] rename failed (non-fatal):", err);
  });

  // 3. Send the question, prefixed with the tool-disable instruction.
  const promptText = `${BTW_INSTRUCTION}\n\n${question}`;
  const promptRes = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(forkSessionId)}/prompt_async`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: promptText }],
        ...(model ? { model } : {}),
      }),
    },
  );
  if (!promptRes.ok) {
    throw new Error(
      `prompt failed: ${promptRes.status} ${await promptRes.text()}`,
    );
  }

  // 4. Poll for the assistant's completed response on the fork.
  let answer = "";
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const msgsRes = await fetchOpencode(
      port,
      `/session/${encodeURIComponent(forkSessionId)}/message`,
    );
    if (!msgsRes.ok) continue;
    const messages = (await msgsRes.json()) as OpencodeMessageRow[];
    if (!Array.isArray(messages)) continue;
    const lastAssistant = [...messages].reverse().find((m) => {
      if (!m.info || m.info.role !== "assistant") return false;
      const completed = m.info.time?.completed;
      return completed !== null && completed !== undefined && completed > 0;
    });
    if (lastAssistant) {
      answer = lastAssistant.parts
        .filter(
          (p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0,
        )
        .map((p) => p.text as string)
        .join("\n\n");
      break;
    }
  }

  if (!answer) {
    answer = "[/btw timeout] No response within 5 minutes.";
  }

  // 5. Archive the fork (best-effort; failure doesn't block the answer).
  await fetchOpencode(
    port,
    `/session/${encodeURIComponent(forkSessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time: { archived: Date.now() } }),
    },
  ).catch((err) => {
    console.warn("[btw] archive failed (non-fatal):", err);
  });

  // 6. Write the answer synthetic-message into the parent's chat log.
  insertSynthetic({
    parentSessionId,
    btwIndex,
    role: "assistant",
    text: answer,
    forkSessionId,
  });
}

export default defineHandler(async (event) => {
  const parentSessionId = parseRouteParam(event, "parent-sid");
  const body = await parseBody(event, bodySchema);
  const { question, port, model } = body;

  const btwIndex = nextBtwIndex(parentSessionId);

  // Write the question synthetic IMMEDIATELY so the chat log shows it
  // within one paint. Per AGENTS.md "Async-action feedback (mandatory)".
  insertSynthetic({
    parentSessionId,
    btwIndex,
    role: "user",
    text: question,
  });

  // Fire-and-forget the orchestration. The frontend keeps polling
  // /messages and the answer synthetic-message lands when it's ready.
  void runBtwOrchestration(port, parentSessionId, btwIndex, question, model).catch(
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[btw] orchestration failed:", msg);
      insertSynthetic({
        parentSessionId,
        btwIndex,
        role: "assistant",
        text: `[/btw error] ${msg}`,
      });
    },
  );

  return {
    btwIndex,
    accepted: true,
  };
});
