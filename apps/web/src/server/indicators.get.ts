import { defineHandler, getQuery } from "nitro/h3";

import { getSnapshot } from "./lib/indicator-state";

export default defineHandler((event) => {
  const q = getQuery(event);
  const serverId =
    typeof q.server === "string" && q.server.length > 0 ? q.server : undefined;
  const sessionId =
    typeof q.session === "string" && q.session.length > 0
      ? q.session
      : undefined;
  return { sessions: getSnapshot({ serverId, sessionId }), ok: true };
});
