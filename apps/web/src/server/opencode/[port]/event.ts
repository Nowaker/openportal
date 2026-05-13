import { defineHandler } from "nitro/h3";
import { resolveLiveTarget } from "../../lib/opencode-client";
import { basicAuthHeader } from "../../lib/server-discovery";
import { parsePort } from "../../lib/validation";
import { invalidateMessagesCache } from "../../lib/messages-cache";

// SSE pass-through proxy with cache-invalidation tap. opencode emits
// text/event-stream at /event; we open ONE upstream fetch per browser
// EventSource. As bytes flow, we (a) buffer-and-scan for SSE event
// boundaries, (b) invalidate the per-session messages cache on
// message.part.* events so the next /messages fetch (triggered by the
// client's SWR mutate on the same event) reads fresh data instead of
// the 2s-stale cache, and (c) pipe bytes through verbatim downstream
// so opencode's event JSON shapes reach the browser unmodified.
//
// Without this tap, the 2s messages-cache TTL was masking SSE-driven
// updates: client got the SSE event, mutate fired, /messages refetch
// hit the still-warm cache and returned stale data. User saw the
// 'Thinking...' indicator advance but no token-by-token streaming
// because the cache held the pre-delta snapshot.

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
  const upstreamUrl = `http://${target.host}:${target.port}/event`;
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

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
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
          // malformed frame; ignore and keep streaming
        }
      }
    },
    flush() {
      // buffer drains naturally; encoder/decoder are cheap stateless
      void encoder;
    },
  });

  return new Response(upstream.body.pipeThrough(tap), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
