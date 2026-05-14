// Shared permission reply + audit recording. Two callers:
//
//   1. The HTTP route at /api/opencode/{port}/permission/{requestId}/reply
//      (user-driven manual approvals from the chat UI).
//   2. The auto-approve worker plugin (server-side fired when a
//      permission.asked event arrives and the effective auto-approve
//      flag is on).
//
// Both must capture the audit snapshot (via permission.list lookup)
// BEFORE handing off to opencode, since opencode reaps replied
// requests on reply; without the pre-fetch we lose every replied
// permission's metadata (patterns, type, tool name, callId, messageId).

import {
  getOpencodeClient,
  getOpencodeClientV2,
} from "./opencode-client";
import {
  recordPermissionDecision,
  type PermissionDecision,
} from "./permission-audit";

export type ReplyDecision = "once" | "always" | "reject";

export interface ReplyOptions {
  message?: string;
  auto?: boolean;
}

interface UpstreamPermission {
  id: string;
  sessionID: string;
  type?: string;
  patterns?: string[];
  tool?: { messageID?: string; callID?: string; name?: string };
}

export async function replyToPermission(
  port: number,
  requestId: string,
  decision: ReplyDecision,
  options: ReplyOptions = {},
): Promise<unknown> {
  let snapshot: PermissionDecision | null = null;
  try {
    const v1 = await getOpencodeClient(port);
    const list = await v1.permission.list();
    const all = (list.data ?? []) as UpstreamPermission[];
    const match = all.find((p) => p.id === requestId);
    if (match) {
      snapshot = {
        requestId: match.id,
        sessionId: match.sessionID,
        messageId: match.tool?.messageID,
        callId: match.tool?.callID,
        decision,
        decidedAt: Date.now(),
        patterns: Array.isArray(match.patterns) ? match.patterns : [],
        permissionType: typeof match.type === "string" ? match.type : "",
        toolName: match.tool?.name,
        auto: options.auto === true,
      };
    }
  } catch {
    // Best-effort capture - never block the reply.
  }

  const client = await getOpencodeClientV2(port);
  const result = await client.permission.reply({
    requestID: requestId,
    reply: decision,
    message: options.message,
  });

  if (snapshot) {
    recordPermissionDecision(port, snapshot);
  }

  return result.data;
}
