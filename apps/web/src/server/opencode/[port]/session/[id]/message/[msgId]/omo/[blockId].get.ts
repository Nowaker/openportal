import { HTTPError, defineHandler } from "nitro/h3";
import { getOmoBody } from "../../../../../../../lib/omo-strip-cache";
import { parseRouteParam } from "../../../../../../../lib/validation";

export default defineHandler((event) => {
  const sessionId = parseRouteParam(event, "id");
  const messageId = parseRouteParam(event, "msgId");
  const blockId = parseRouteParam(event, "blockId");
  const text = getOmoBody(sessionId, messageId, blockId);
  if (text === null) {
    throw new HTTPError("omo body not in cache (server restarted?)", {
      status: 404,
    });
  }
  return { text };
});
