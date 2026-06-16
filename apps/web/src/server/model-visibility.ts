import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  clearServerVisibility,
  clearVisibility,
  getModelVisibility,
  setVisibility,
} from "./lib/model-visibility-state";
import { parseBody } from "./lib/validation";

const setSchema = z.object({
  serverId: z.string().min(1),
  modelKey: z.string().min(1),
  visibility: z.enum(["show", "hide"]),
});

const clearOneSchema = z.object({
  serverId: z.string().min(1),
  modelKey: z.string().min(1),
  clear: z.literal(true),
});

const clearServerSchema = z.object({
  serverId: z.string().min(1),
  clearServer: z.literal(true),
});

const bodySchema = setSchema.or(clearOneSchema).or(clearServerSchema);

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getModelVisibility();
  }
  if (method === "PUT") {
    const body = await parseBody(event, bodySchema);
    if ("visibility" in body) {
      setVisibility(body.serverId, body.modelKey, body.visibility);
    } else if ("clearServer" in body) {
      clearServerVisibility(body.serverId);
    } else {
      clearVisibility(body.serverId, body.modelKey);
    }
    return getModelVisibility();
  }
  return new Response("Method not allowed", { status: 405 });
});
