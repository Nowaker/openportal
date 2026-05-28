import { defineHandler, getRouterParam, setResponseStatus } from "nitro/h3";
import { subscribeRun, type ProgressEvent } from "../../lib/long-op-runner";
import {
  heartbeatFrame,
  HEARTBEAT_INTERVAL_MS,
} from "../../lib/sse-heartbeat";

const encoder = new TextEncoder();

export default defineHandler((event) => {
  const runId = getRouterParam(event, "runId");
  if (!runId) {
    setResponseStatus(event, 400);
    return { ok: false, error: "runId required" };
  }

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: ProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          /* controller closed */
        }
      };

      const result = subscribeRun(runId, send);
      if (!result) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: "unknown_run", runId })}\n\n`,
            ),
          );
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }

      for (const e of result.events) send(e);

      if (result.terminated) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: "stream_end", replay: true })}\n\n`,
            ),
          );
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }

      unsubscribe = result.unsubscribe;
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(heartbeatFrame());
        } catch {
          /* controller closed */
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      closed = true;
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
