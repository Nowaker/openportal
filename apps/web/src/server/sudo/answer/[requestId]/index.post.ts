import { z } from "zod/v4";
import { defineHandler, HTTPError } from "nitro/h3";
import { parseRouteParam, parseBody } from "../../../lib/validation";
import { answerPendingSudo } from "../../../lib/sudo-pending";

const bodySchema = z.union([
  z.object({ password: z.string().min(1) }),
  z.object({ deny: z.literal(true), reason: z.string().max(256).optional() }),
]);

export default defineHandler(async (event) => {
  const requestId = parseRouteParam(event, "requestId");
  const body = await parseBody(event, bodySchema);

  const ok =
    "deny" in body
      ? answerPendingSudo(requestId, { kind: "deny", reason: body.reason })
      : answerPendingSudo(requestId, { kind: "password", password: body.password });

  if (!ok) {
    throw new HTTPError("unknown or expired request_id", { status: 404 });
  }
  return { ok: true };
});
