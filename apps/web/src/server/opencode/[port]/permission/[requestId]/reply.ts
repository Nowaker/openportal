import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import { replyToPermission } from "../../../../lib/permission-reply";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";

const permissionReplySchema = z.object({
  reply: z.enum(["once", "always", "reject"]),
  message: z.string().optional(),
  auto: z.boolean().optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const requestId = parseRouteParam(event, "requestId");
  const body = await parseBody(event, permissionReplySchema);

  return replyToPermission(port, requestId, body.reply, {
    message: body.message,
    auto: body.auto,
  });
});
