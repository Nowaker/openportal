import { defineHandler, getQuery } from "nitro/h3";
import {
  getOpencodeClient,
  getOpencodeClientV2,
} from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";

// Two consumer modes, distinguished by ?includeStale=1:
//
//   default (filtered) - sidebar badge / SWR poll. opencode does not
//     auto-clean question requests when the model gives up on the
//     question and the conversation moves on, so a session that asked
//     once and then continued for hours would show up red ("waiting on
//     answer") forever. Drop questions whose tool.messageID is older
//     than the session's latest message - chat moved past it.
//
//   includeStale=1 (unfiltered) - reply-form match resolution. The
//     question form needs to map (callID -> requestID) even when the
//     user already typed follow-up messages between the question
//     prompt and clicking Submit. The stale filter was eating the
//     match in exactly that scenario, forcing the form into its
//     text-prompt fallback and leaving opencode's question pending
//     forever (the trigger for the user-reported stuck session).
//
// Comparison is lexical: opencode message IDs are time-sortable (UTC
// ms epoch in the prefix), so messageID-A < messageID-B iff A was
// created before B.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const q = getQuery(event);
  const includeStale = q.includeStale === "1" || q.includeStale === "true";

  const v2 = await getOpencodeClientV2(port);
  const result = await v2.question.list();
  const questions = (result.data ?? []) as Array<{
    id: string;
    sessionID: string;
    tool?: { messageID?: string };
    [k: string]: unknown;
  }>;

  if (includeStale) return questions;

  const v1 = await getOpencodeClient(port);
  const fresh: typeof questions = [];
  for (const qr of questions) {
    const toolMsgId = qr.tool?.messageID;
    if (!toolMsgId) {
      fresh.push(qr);
      continue;
    }
    try {
      const latest = await v1.session.messages({
        path: { id: qr.sessionID },
        query: { limit: 1 },
      });
      const list = (latest.data ?? []) as Array<{ info: { id: string } }>;
      const latestId = list[list.length - 1]?.info?.id;
      if (!latestId || latestId <= toolMsgId) {
        fresh.push(qr);
      }
    } catch {
      fresh.push(qr);
    }
  }
  return fresh;
});
