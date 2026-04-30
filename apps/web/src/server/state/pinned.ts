import { defineHandler, readBody, getMethod } from "nitro/h3";
import {
  getPinnedSessions,
  pinSession,
  unpinSession,
  reorderPinnedSessions,
} from "../lib/portal-state";

interface PinBody {
  sessionId?: unknown;
  action?: unknown;
  order?: unknown;
}

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return { sessions: getPinnedSessions() };
  }
  const body = (await readBody(event)) as PinBody | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (action === "reorder") {
    const order = Array.isArray(body?.order)
      ? body.order.filter((s): s is string => typeof s === "string")
      : [];
    return { sessions: reorderPinnedSessions(order) };
  }
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!sessionId) return { sessions: getPinnedSessions() };
  if (action === "pin") return { sessions: pinSession(sessionId) };
  if (action === "unpin") return { sessions: unpinSession(sessionId) };
  return { sessions: getPinnedSessions() };
});
