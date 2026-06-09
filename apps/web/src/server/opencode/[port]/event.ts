import { defineHandler } from "nitro/h3";
import { resolveLiveTarget } from "../../lib/opencode-client";
import { basicAuthHeader } from "../../lib/server-discovery";
import { buildServerOrigin } from "../../lib/server-registry";
import { parsePort } from "../../lib/validation";
import { invalidateMessagesCache } from "../../lib/messages-cache";
import {
  heartbeatFrame,
  HEARTBEAT_INTERVAL_MS,
} from "../../lib/sse-heartbeat";

// SSE pass-through proxy with cache-invalidation tap and
// Portal-injected heartbeats. Opens ONE upstream fetch per
// browser EventSource. The original implementation was a
// TransformStream that piped upstream bytes verbatim downstream
// and tapped them for cache invalidation; this revision swaps to
// a custom ReadableStream so we can ALSO push Portal-level
// heartbeat data frames on a setInterval. Upstream opencode
// emits no heartbeat of its own, so without injection the
// downstream socket can sit silent for minutes during idle
// sessions and the client-side sse-watchdog (which trips on
// onmessage silence) cannot tell a healthy idle stream apart
// from a half-closed dead one. See lib/sse-heartbeat.ts for why
// we use data frames, not SSE comments.
//
// Cache-invalidation tap (unchanged from the TransformStream
// version): buffer-and-scan for SSE event boundaries; on
// message.part.* / message.* / message.removed events invalidate
// the per-session messages cache so the next /messages fetch
// triggered by the client's SWR mutate reads fresh data. Without
// this tap the 2s messages-cache TTL would mask streaming
// updates.

const DELTA_EVENT_TYPES = new Set([
  "message.part.delta",
  "message.part.updated",
  "message.updated",
  "message.part.removed",
  "message.removed",
]);

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const target = await resolveLiveTarget(port);
  const upstreamUrl = `${buildServerOrigin(target.protocol, target.host, target.port)}/event`;
  const upstream = await fetch(upstreamUrl, {
    headers: {
      Accept: "text/event-stream",
      ...basicAuthHeader(target.auth),
    },
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(`opencode SSE upstream failed: ${upstream.status}`, {
      status: 502,
    });
  }

  const upstreamBody = upstream.body;
  const decoder = new TextDecoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
        try {
          controller.enqueue(heartbeatFrame());
        } catch {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        }
      }, HEARTBEAT_INTERVAL_MS);

      const reader = upstreamBody.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          try {
            controller.enqueue(value);
          } catch {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            const dataLine = frame
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json) continue;
            try {
              const ev = JSON.parse(json) as {
                type?: string;
                properties?: { sessionID?: unknown };
              };
              if (
                ev?.type &&
                DELTA_EVENT_TYPES.has(ev.type) &&
                typeof ev.properties?.sessionID === "string"
              ) {
                invalidateMessagesCache(ev.properties.sessionID);
              }
            } catch {
              /* malformed frame from opencode; ignore */
            }
          }
        }
      } catch {
        /* upstream error - reader read() rejected. Fall through
           to cleanup; downstream will see the controller close. */
      } finally {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      /* Browser disconnected. The reader.read() loop will
         reject on the next iteration and run the cleanup in
         the finally block. */
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
