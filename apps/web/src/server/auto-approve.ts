import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  getAutoApproveConfig,
  setAutoApproveDefault,
} from "./lib/auto-approve-state";
import { parseBody } from "./lib/validation";

const defaultBodySchema = z.object({ value: z.boolean() });

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getAutoApproveConfig();
  }
  if (method === "PUT") {
    const body = await parseBody(event, defaultBodySchema);
    return setAutoApproveDefault(body.value);
  }
  return new Response("Method not allowed", { status: 405 });
});
