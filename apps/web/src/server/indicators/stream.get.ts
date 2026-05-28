// SSE delta feed for indicator state. Frames sent on connect and
// on every state mutation: snapshot, update, remove,
// server-connected, server-disconnected, plus periodic heartbeat
// (see lib/sse-heartbeat.ts for why heartbeats are data frames).

import { defineHandler, getQuery } from "nitro/h3";

import {
  getSnapshot,
  subscribe,
  type SubscriberPayload,
} from "../lib/indicator-state";
import { heartbeatFrame, HEARTBEAT_INTERVAL_MS } from "../lib/sse-heartbeat";

const encoder = new TextEncoder();

export default defineHandler((event) => {
  const q = getQuery(event);
  const serverId =
    typeof q.server === "string" && q.server.length > 0 ? q.server : undefined;
  const sessionId =
    typeof q.session === "string" && q.session.length > 0
      ? q.session
      : undefined;

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: SubscriberPayload) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          /* controller closed */
        }
      };

      send({
        type: "snapshot",
        sessions: getSnapshot({ serverId, sessionId }),
      });

      unsubscribe = subscribe({ serverId, sessionId }, send);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(heartbeatFrame());
        } catch {
          /* controller closed */
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
