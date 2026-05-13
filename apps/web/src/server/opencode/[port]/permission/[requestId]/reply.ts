import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import {
  getOpencodeClient,
  getOpencodeClientV2,
} from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam, parseBody } from "../../../../lib/validation";
import {
  recordPermissionDecision,
  type PermissionDecision,
} from "../../../../lib/permission-audit";

const permissionReplySchema = z.object({
  reply: z.enum(["once", "always", "reject"]),
  message: z.string().optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const requestId = parseRouteParam(event, "requestId");
  const body = await parseBody(event, permissionReplySchema);

  let snapshot: PermissionDecision | null = null;
  try {
    const v1 = await getOpencodeClient(port);
    const list = await v1.permission.list();
    const all = (list.data ?? []) as Array<{
      id: string;
      sessionID: string;
      type?: string;
      patterns?: string[];
      tool?: { messageID?: string; callID?: string; name?: string };
    }>;
    const match = all.find((p) => p.id === requestId);
    if (match) {
      snapshot = {
        requestId: match.id,
        sessionId: match.sessionID,
        messageId: match.tool?.messageID,
        callId: match.tool?.callID,
        decision: body.reply,
        decidedAt: Date.now(),
        patterns: Array.isArray(match.patterns) ? match.patterns : [],
        permissionType: typeof match.type === "string" ? match.type : "",
        toolName: match.tool?.name,
      };
    }
  } catch {
    // Best-effort capture - never block the reply.
  }

  const client = await getOpencodeClientV2(port);
  const result = await client.permission.reply({
    requestID: requestId,
    reply: body.reply,
    message: body.message,
  });

  if (snapshot) {
    recordPermissionDecision(port, snapshot);
  }

  return result.data;
});
