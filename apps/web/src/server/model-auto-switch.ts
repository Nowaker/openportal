import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  getModelAutoSwitchConfig,
  removeAgentPref,
  setAgentPref,
  setEnabled,
} from "./lib/model-auto-switch-state";
import { parseBody } from "./lib/validation";

const ruleSchema = z.enum(["agent-default", "specific", "no-change"]);

const putBodySchema = z.union([
  // Master switch
  z.object({ enabled: z.boolean() }),
  // Per-agent preference
  z.object({
    family: z.string().min(1),
    modelRule: ruleSchema.optional(),
    modelKey: z.string().nullable().optional(),
    variantRule: ruleSchema.optional(),
    variant: z.string().nullable().optional(),
  }),
  // Per-agent removal
  z.object({ family: z.string().min(1), remove: z.literal(true) }),
]);

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getModelAutoSwitchConfig();
  }
  if (method === "PUT") {
    const body = await parseBody(event, putBodySchema);
    if ("enabled" in body) {
      return setEnabled(body.enabled);
    }
    if ("remove" in body) {
      return removeAgentPref(body.family);
    }
    const pref: Parameters<typeof setAgentPref>[1] = {};
    if (body.modelRule !== undefined) pref.modelRule = body.modelRule;
    if (body.modelKey !== undefined && body.modelKey !== null)
      pref.modelKey = body.modelKey;
    if (body.variantRule !== undefined) pref.variantRule = body.variantRule;
    if (body.variant !== undefined && body.variant !== null)
      pref.variant = body.variant;
    return setAgentPref(body.family, pref);
  }
  return new Response("Method not allowed", { status: 405 });
});
