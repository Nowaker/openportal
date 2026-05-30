// POST /api/btw/<parent-sid>
//
// Orchestrates a /btw side-question:
//
//   1. Compute the next btw_index for this parent session.
//   2. Insert the QUESTION synthetic-message (completed) so the user
//      sees it in the chat log within one paint.
//   3. Insert a PENDING assistant synthetic-message (completed_at=NULL)
//      so the chat log renders an in-flight "Thinking..." entry
//      immediately - no separate UI machinery, the existing
//      info.time.completed=null pattern handles it.
//   4. Return 202 with { btwIndex, questionId, pendingAnswerId }.
//   5. Background-orchestrate: fork the parent at HEAD, rename the
//      fork to [btw#N] <truncated-question>, capture promptSentAt,
//      send the question with a tool-disable instruction, poll for an
//      assistant message that was CREATED after promptSentAt and is
//      completed, archive the fork, then UPDATE the pending row with
//      the answer text + completed_at.
//
// Wrong-answer bug fix (v1 -> v2): the v1 poll picked the last
// completed assistant message in the fork, which was an INHERITED
// completion from the parent's history (forks preserve all parent
// messages). The promptSentAt watermark is the fix: only assistants
// CREATED after we sent the prompt count.
//
// Tool-disable: the BTW_INSTRUCTION prefix is a strong system-prompt
// addendum. A stricter server-side enforcement (custom agent with
// empty tool set) is a follow-up.

import { defineHandler } from "nitro/h3";
import { z } from "zod/v4";
import { fetchOpencode } from "../../lib/opencode-client";
import { parseBody, parseRouteParam } from "../../lib/validation";
import {
  insertSynthetic,
  nextBtwIndex,
  updateSyntheticAnswer,
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
    time?: { created?: number | null; completed?: number | null };
  };
  parts: Array<{ type: string; text?: string }>;
}

// Exported so the e2e test can drive the orchestration directly
// against a real opencode without going through the HTTP route.
export async function runBtwOrchestration(opts: {
  port: number;
  parentSessionId: string;
  btwIndex: number;
  pendingAnswerId: string;
  question: string;
  model?: { providerID: string; modelID: string };
}): Promise<void> {
  const {
    port,
    parentSessionId,
    btwIndex,
    pendingAnswerId,
    question,
    model,
  } = opts;
  try {
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
      throw new Error(
        `fork failed: ${forkRes.status} ${await forkRes.text()}`,
      );
    }
    const forkBody = (await forkRes.json()) as { id: string };
    const forkSessionId = forkBody.id;

    // 2. Rename the fork to [btw#N] <truncated question>. The
    // `[btw#` prefix is the filter used by useSessions to hide the
    // fork from the live sidebar.
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

    // 3. Capture the watermark BEFORE sending the prompt so the
    // poller can distinguish the new assistant message from any
    // inherited completed assistants in the fork's copied history.
    const promptSentAt = Date.now();

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

    // 4. Poll for an assistant message that was CREATED after our
    // promptSentAt watermark AND has a completed timestamp.
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
      const winner = [...messages].reverse().find((m) => {
        if (!m.info || m.info.role !== "assistant") return false;
        const created = m.info.time?.created ?? 0;
        const completed = m.info.time?.completed ?? 0;
        return created > promptSentAt && completed > 0;
      });
      if (winner) {
        answer = winner.parts
          .filter(
            (p) =>
              p.type === "text" &&
              typeof p.text === "string" &&
              p.text.length > 0,
          )
          .map((p) => p.text as string)
          .join("\n\n");
        break;
      }
    }

    if (!answer) {
      answer = "[/btw timeout] No response within 5 minutes.";
    }

    // 5. Archive the fork (best-effort; failure does not block the
    // answer write).
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

    // 6. Fill the pending assistant row.
    updateSyntheticAnswer(pendingAnswerId, answer, forkSessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[btw] orchestration failed:", msg);
    updateSyntheticAnswer(
      pendingAnswerId,
      `[/btw error] ${msg}`,
      null,
    );
  }
}

export default defineHandler(async (event) => {
  const parentSessionId = parseRouteParam(event, "parent-sid");
  const body = await parseBody(event, bodySchema);
  const { question, port, model } = body;

  const btwIndex = nextBtwIndex(parentSessionId);

  // Question row: completed immediately so the user sees it in chat
  // within one paint.
  const questionRow = insertSynthetic({
    parentSessionId,
    btwIndex,
    role: "user",
    text: question,
  });

  // Pending assistant row: completed_at=NULL renders as in-flight
  // (the messages.ts wrapper maps completed_at -> info.time.completed,
  // and the existing "Thinking..." indicator path handles null).
  const pendingAnswer = insertSynthetic({
    parentSessionId,
    btwIndex,
    role: "assistant",
    text: "",
    pending: true,
  });

  void runBtwOrchestration({
    port,
    parentSessionId,
    btwIndex,
    pendingAnswerId: pendingAnswer.id,
    question,
    model,
  });

  return {
    btwIndex,
    questionId: questionRow.id,
    pendingAnswerId: pendingAnswer.id,
    accepted: true,
  };
});
