import { defineHandler } from "nitro/h3";
import {
  subscribeStuckEvents,
  type StuckDetectorEvent,
} from "../../lib/stuck-detector-events";
import {
  heartbeatFrame,
  HEARTBEAT_INTERVAL_MS,
} from "../../lib/sse-heartbeat";

export default defineHandler((event) => {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(heartbeatFrame());
      const send = (e: StuckDetectorEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(e)}\n\n`),
          );
        } catch {
          /* controller closed by client disconnect */
        }
      };
      unsubscribe = subscribeStuckEvents(send);
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
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
