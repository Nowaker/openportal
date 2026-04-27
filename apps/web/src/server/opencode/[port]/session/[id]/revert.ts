import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";

const revertBodySchema = z.object({
  messageID: z.string().min(1),
  partID: z.string().optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const body = await parseBody(event, revertBodySchema);

  try {
    const result = await getOpencodeClient(port).session.revert({
      path: { id },
      body,
    });
    return result.data;
  } catch (error) {
    throw new HTTPError(
      error instanceof Error ? error.message : "Revert failed",
      { status: 500 },
    );
  }
});
