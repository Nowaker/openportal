import { HTTPError, defineHandler } from "nitro/h3";
import { getOpencodeClient } from "../../../../../../lib/opencode-client";
import {
  parsePort,
  parseRouteParam,
} from "../../../../../../lib/validation";

interface PartLike {
  id?: string;
  type?: string;
  text?: string;
  state?: { input?: unknown; output?: unknown; metadata?: unknown };
  data?: { state?: { input?: unknown; output?: unknown; metadata?: unknown } };
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const sessionId = parseRouteParam(event, "id");
  const partId = parseRouteParam(event, "partId");
  const client = await getOpencodeClient(port);
  const res = await client.session.messages({ path: { id: sessionId } });
  const data = (res.data ?? []) as Array<{ parts?: PartLike[]; info?: { id?: string } }>;
  for (const msg of data) {
    for (const part of msg.parts ?? []) {
      if (part.id === partId) {
        return {
          ok: true,
          messageId: msg.info?.id ?? null,
          partId,
          type: part.type ?? null,
          text: typeof part.text === "string" ? part.text : null,
          state: part.state ?? part.data?.state ?? null,
        };
      }
    }
  }
  throw new HTTPError("part not found", { status: 404 });
});
