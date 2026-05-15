import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  getInstanceSettings,
  setToolOutputMaxBytes,
} from "./lib/instance-settings-state";
import { parseBody } from "./lib/validation";

const updateBodySchema = z.object({
  toolOutputMaxBytes: z.number().int().positive().nullable(),
});

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getInstanceSettings();
  }
  if (method === "PUT") {
    const body = await parseBody(event, updateBodySchema);
    setToolOutputMaxBytes(body.toolOutputMaxBytes);
    return getInstanceSettings();
  }
  return new Response("Method not allowed", { status: 405 });
});
