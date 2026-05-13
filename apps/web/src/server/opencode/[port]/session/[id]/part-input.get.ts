import { HTTPError, defineHandler, getQuery } from "nitro/h3";

import { getOpencodeClient } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

interface PartLike {
  id?: string;
  callID?: string;
  state?: { input?: unknown; output?: unknown };
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionId = parseRouteParam(event, "id");
  const query = getQuery(event);
  const partId =
    typeof query.partId === "string" ? query.partId : undefined;
  const callId = typeof query.callId === "string" ? query.callId : undefined;
  if (!partId && !callId) {
    throw new HTTPError("partId or callId query required", { status: 400 });
  }
  const client = await getOpencodeClient(port);
  const res = await client.session.messages({ path: { id: sessionId } });
  const data = (res.data ?? []) as Array<{ parts?: PartLike[] }>;
  for (const msg of data) {
    for (const part of msg.parts ?? []) {
      const matches =
        (partId && part.id === partId) ||
        (callId && part.callID === callId);
      if (matches) {
        return {
          id: part.id ?? null,
          callId: part.callID ?? null,
          input: part.state?.input ?? null,
          output: part.state?.output ?? null,
        };
      }
    }
  }
  throw new HTTPError("part not found", { status: 404 });
});
