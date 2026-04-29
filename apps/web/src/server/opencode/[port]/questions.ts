import { defineHandler } from "nitro/h3";
import {
  getOpencodeClient,
  getOpencodeClientV2,
} from "../../lib/opencode-client";
import { parsePort } from "../../lib/validation";

// opencode does not auto-clean question requests when the model gives up on
// the question and the conversation moves on. Without this filter, a session
// that asked a question once and then continued for hours would still show
// up red ("waiting on answer") in the sidebar forever. Drop questions whose
// tool.messageID is older than the session's latest message - chat moved
// past it, the answer no longer matters.
//
// Comparison is lexical: opencode message IDs are time-sortable (UTC ms
// epoch encoded into the prefix), so messageID-A < messageID-B iff A was
// created before B.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const v2 = getOpencodeClientV2(port);
  const v1 = getOpencodeClient(port);
  const result = await v2.question.list();
  const questions = (result.data ?? []) as Array<{
    id: string;
    sessionID: string;
    tool?: { messageID?: string };
    [k: string]: unknown;
  }>;

  const fresh: typeof questions = [];
  for (const q of questions) {
    const toolMsgId = q.tool?.messageID;
    if (!toolMsgId) {
      fresh.push(q);
      continue;
    }
    try {
      const latest = await v1.session.messages({
        path: { id: q.sessionID },
        query: { limit: 1 },
      });
      const list = (latest.data ?? []) as Array<{ info: { id: string } }>;
      const latestId = list[list.length - 1]?.info?.id;
      if (!latestId || latestId <= toolMsgId) {
        fresh.push(q);
      }
    } catch {
      fresh.push(q);
    }
  }
  return fresh;
});
