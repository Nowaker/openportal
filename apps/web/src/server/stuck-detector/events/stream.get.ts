import { defineHandler } from "nitro/h3";
import {
  subscribeStuckEvents,
  type StuckDetectorEvent,
} from "../../lib/stuck-detector-events";

export default defineHandler((event) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(": ok\n\n"));
      const send = (e: StuckDetectorEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(e)}\n\n`),
          );
        } catch {
          // controller closed by client disconnect
        }
      };
      const unsubscribe = subscribeStuckEvents(send);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // ignore
        }
      }, 30_000);
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const req = event.node?.req;
      if (req) {
        req.once("close", cleanup);
      }
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
