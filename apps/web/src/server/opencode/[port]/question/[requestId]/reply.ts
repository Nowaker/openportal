import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import { getOpencodeClientV2 } from "../../../../lib/opencode-client";
import { resolveOwner } from "../../../../lib/prompt-routing";
import { parsePort, parseRouteParam, parseBody } from "../../../../lib/validation";

const questionReplySchema = z.object({
  answers: z.array(z.array(z.string())),
  sessionId: z.string().optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const requestId = parseRouteParam(event, "requestId");
  const body = await parseBody(event, questionReplySchema);

  const owner = body.sessionId ? await resolveOwner(body.sessionId, port) : null;
  const targetPort = owner?.port ?? port;
  const client = await getOpencodeClientV2(targetPort);
  const result = await client.question.reply({
    requestID: requestId,
    answers: body.answers,
  });

  return result.data;
});
