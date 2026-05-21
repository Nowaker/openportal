import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  getOpencodeVersionInfo,
  acknowledgeOpencodeVersion,
} from "./lib/opencode-version-state";
import { parseBody } from "./lib/validation";

const ackBodySchema = z.object({
  version: z.string().min(1).max(64).nullable().optional(),
});

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getOpencodeVersionInfo();
  }
  if (method === "POST" || method === "PUT") {
    const body = await parseBody(event, ackBodySchema);
    return acknowledgeOpencodeVersion(body.version ?? null);
  }
  return new Response("Method not allowed", { status: 405 });
});
