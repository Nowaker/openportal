import { z } from "zod/v4";
import { defineHandler } from "nitro/h3";
import { startForkJob } from "../../../../lib/fork-jobs";
import {
  parsePort,
  parseRouteParam,
  parseBody,
} from "../../../../lib/validation";

const forkBodySchema = z.object({
  messageID: z.string().min(1).optional(),
});

// opencode's fork copies the whole conversation and holds the response
// open the entire time, so a large session can blow past Caddy's 5m
// response_header_timeout and 504 the browser. We start the fork as a
// detached server-side job and return its id immediately; the client
// polls GET /api/opencode/:port/fork-job/:jobId until it finishes. Every
// browser-facing request stays short, so the proxy timeout never fires.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionID = parseRouteParam(event, "id");
  const { messageID } = await parseBody(event, forkBodySchema);

  const { jobId } = startForkJob({
    port,
    sourceSessionId: sessionID,
    messageID,
  });
  return { jobId };
});
