import { defineHandler, readBody, getMethod } from "nitro/h3";
import { getLastViewedMap, setLastViewed } from "../lib/portal-state";

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getLastViewedMap();
  }
  if (method === "POST") {
    const body = (await readBody(event)) as
      | { sessionId?: string; sessionIds?: string[]; ms?: number }
      | undefined;
    const ms = typeof body?.ms === "number" ? body.ms : Date.now();

    if (Array.isArray(body?.sessionIds)) {
      for (const id of body.sessionIds) {
        if (typeof id === "string" && id) setLastViewed(id, ms);
      }
      return { ok: true, count: body.sessionIds.length, ms };
    }

    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      throw new Error("sessionId or sessionIds required");
    }
    setLastViewed(sessionId, ms);
    return { ok: true, sessionId, ms };
  }
  throw new Error("method not allowed");
});
