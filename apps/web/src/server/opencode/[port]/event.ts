import { defineHandler } from "nitro/h3";
import { resolveLiveTarget } from "../../lib/opencode-client";
import { basicAuthHeader } from "../../lib/server-discovery";
import { parsePort } from "../../lib/validation";

// SSE pass-through proxy: opencode emits text/event-stream at /event;
// we open ONE upstream fetch per browser EventSource and pipe Response.body
// through verbatim. No buffering, no parsing, no rewriting - opencode's
// event types and JSON shapes go straight to the browser. This keeps the
// proxy under ~30 lines and lets useEventStream on the client decode +
// dispatch mutate() calls itself. EventSource auto-reconnects on
// connection drop; closing the browser EventSource cancels Response.body
// which propagates back through bun's fetch and tears the upstream
// connection down on opencode's side.
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
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
