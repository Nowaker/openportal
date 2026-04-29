import { defineHandler, readBody, getMethod } from "nitro/h3";
import { getLastViewedMap, setLastViewed } from "../lib/portal-state";

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return getLastViewedMap();
  }
  if (method === "POST") {
    const body = (await readBody(event)) as
      | { sessionId?: string; ms?: number }
      | undefined;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      throw new Error("sessionId required");
    }
    const ms = typeof body?.ms === "number" ? body.ms : Date.now();
    setLastViewed(sessionId, ms);
    return { ok: true, sessionId, ms };
  }
  throw new Error("method not allowed");
});
