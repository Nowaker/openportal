import { z } from "zod/v4";
import { defineHandler, getMethod } from "nitro/h3";
import {
  setSessionOverride,
  removeSessionOverride,
} from "../../lib/auto-approve-state";
import { parseRouteParam, parseBody } from "../../lib/validation";

const overrideBodySchema = z.object({ value: z.boolean() });

export default defineHandler(async (event) => {
  const sessionId = parseRouteParam(event, "sessionId");
  const method = getMethod(event);
  if (method === "PUT") {
    const body = await parseBody(event, overrideBodySchema);
    return setSessionOverride(sessionId, body.value);
  }
  if (method === "DELETE") {
    return removeSessionOverride(sessionId);
  }
  return new Response("Method not allowed", { status: 405 });
});
