import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  getInstanceSettings,
  resetNotifyPolicy,
  setNotifyRule,
  setToolOutputMaxBytes,
  type NotificationKind,
} from "./lib/instance-settings-state";
import { parseBody } from "./lib/validation";

const toolOutputSchema = z.object({
  toolOutputMaxBytes: z.number().int().positive().nullable(),
});

const notifyRuleSchema = z.object({
  notifyKind: z.enum([
    "session-done",
    "question",
    "permission-ask",
    "api-error",
    "stuck-detected",
  ]),
  notify: z.boolean(),
  notifyEvenIfActiveTab: z.boolean(),
});

const notifyResetSchema = z.object({ resetNotifyPolicy: z.literal(true) });

const updateBodySchema = toolOutputSchema
  .or(notifyRuleSchema)
  .or(notifyResetSchema);

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getInstanceSettings();
  }
  if (method === "PUT") {
    const body = await parseBody(event, updateBodySchema);
    if ("toolOutputMaxBytes" in body) {
      setToolOutputMaxBytes(body.toolOutputMaxBytes);
    } else if ("resetNotifyPolicy" in body) {
      resetNotifyPolicy();
    } else {
      setNotifyRule(body.notifyKind as NotificationKind, {
        notify: body.notify,
        notifyEvenIfActiveTab: body.notifyEvenIfActiveTab,
      });
    }
    return getInstanceSettings();
  }
  return new Response("Method not allowed", { status: 405 });
});
