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
import { recordResolved } from "./permission-log";
import { getServerByPort } from "./server-registry";

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
  let match: UpstreamPermission | null = null;
  try {
    const v1 = await getOpencodeClient(port);
    const list = await v1.permission.list();
    const all = (list.data ?? []) as UpstreamPermission[];
    match = all.find((p) => p.id === requestId) ?? null;
  } catch {
    // Best-effort capture - never block the reply.
  }

  const client = await getOpencodeClientV2(port);
  const result = await client.permission.reply({
    requestID: requestId,
    reply: decision,
    message: options.message,
  });

  if (match) {
    recordResolved({
      serverId: getServerByPort(port)?.id ?? null,
      sessionId: match.sessionID,
      requestId: match.id,
      messageId: match.tool?.messageID ?? null,
      callId: match.tool?.callID ?? null,
      toolName: match.tool?.name ?? null,
      permissionType: typeof match.type === "string" ? match.type : null,
      patterns: Array.isArray(match.patterns) ? match.patterns : [],
      decision,
      auto: options.auto === true,
    });
  }

  return result.data;
}
