import { z } from "zod/v4";
import { HTTPError, defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../lib/opencode-client";
import { parsePort, parseBody } from "../../../lib/validation";

const createSessionSchema = z.object({
  title: z.string().optional(),
  parentID: z.string().optional(),
  directory: z.string().optional(),
});

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const body = await parseBody(event, createSessionSchema);

  const client = await getOpencodeClient(port);
  const session = await client.session.create({
    body: { title: body.title, parentID: body.parentID },
    query: body.directory ? { directory: body.directory } : undefined,
  });
  if (!session.response.ok || !session.data) {
    throw new HTTPError(`Session creation failed (HTTP ${session.response.status})`, { status: session.response.ok ? 502 : session.response.status });
  }

  return session.data;
});
