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
    // The SDK v1 client uses `path: { id }` -> "/session/{id}/revert".
    // Verified working with a direct curl POST against opencode 0.0.3 on
    // port 4505: the call sets `session.revert.messageID` correctly. The
    // initial revert UI bug was on the CLIENT side - the visible message
    // list was not filtering by `session.revert.messageID`, so the user
    // saw their old messages even though the backend had registered the
    // revert pointer.
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
