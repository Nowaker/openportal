import { defineHandler, readBody, getMethod } from "nitro/h3";
import {
  addStarredMessage,
  getStarredMessages,
  removeStarredMessage,
  type StarredMessage,
} from "../lib/starred-messages-state";

interface StarBody {
  action?: unknown;
  serverId?: unknown;
  sessionId?: unknown;
  messageId?: unknown;
  role?: unknown;
  snippet?: unknown;
  sessionTitle?: unknown;
  directory?: unknown;
}

export default defineHandler(async (event) => {
  const method = getMethod(event);
  if (method === "GET") {
    return { items: getStarredMessages() };
  }
  const body = (await readBody(event)) as StarBody | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const serverId = typeof body?.serverId === "string" ? body.serverId : "";
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  if (!serverId || !messageId) {
    return { items: getStarredMessages() };
  }
  if (action === "remove") {
    return { items: removeStarredMessage(serverId, messageId) };
  }
  if (action === "add") {
    const sessionId =
      typeof body?.sessionId === "string" ? body.sessionId : "";
    const role =
      body?.role === "user" || body?.role === "assistant" ? body.role : null;
    if (!sessionId || !role) return { items: getStarredMessages() };
    const entry: StarredMessage = {
      serverId,
      sessionId,
      messageId,
      role,
      starredAt: Date.now(),
      snippet:
        typeof body?.snippet === "string" ? body.snippet : undefined,
      sessionTitle:
        typeof body?.sessionTitle === "string"
          ? body.sessionTitle
          : undefined,
      directory:
        typeof body?.directory === "string" ? body.directory : undefined,
    };
    return { items: addStarredMessage(entry) };
  }
  return { items: getStarredMessages() };
});
