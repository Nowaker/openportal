// SSE delta feed for indicator state.
//
// Browser opens this endpoint once and receives:
//   - One `data: {"type":"snapshot",...}` frame on connect with the
//     current full state (filtered by optional ?server= / ?session=).
//   - Subsequent `data: {"type":"update"|"remove"|"server-connected"|
//     "server-disconnected",...}` frames as indicator-state mutates.
//
// Heartbeat: a `: keepalive` SSE comment every 25s prevents proxies
// (Caddy idle-close default 60s) from severing the connection.
//
// Cleanup uses the ReadableStream cancel callback - fires when the
// downstream consumer (EventSource) closes the connection. h3 v2's
// event has no node-style req object so we cannot attach 'close'
// listeners the way the legacy event.ts proxy does.

import { defineHandler, getQuery } from "nitro/h3";

import {
  getSnapshot,
  subscribe,
  type SubscriberPayload,
} from "../lib/indicator-state";

const HEARTBEAT_MS = 25_000;
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
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          /* controller closed */
        }
      }, HEARTBEAT_MS);
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
