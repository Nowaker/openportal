import type { HTTPError, HTTPEvent } from "nitro/h3";
import { setResponseStatus } from "nitro/h3";

// Single Nitro errorHandler covering two distinct failure rewrites:
//
//   /assets/* 500 -> 404. When the in-memory asset manifest references
//   a file that's gone from disk (deploy race: process started with
//   build vN, disk now has vN+1), the static handler throws and lands
//   on 500. The browser's <script> error handler treats 500 as
//   "server failure" instead of "asset missing", which blocks the
//   inline recovery path. 404 is the honest status and matches what a
//   well-behaved CDN would serve for the same content.
//
//   /api/opencode/<port>/* upstream-unreachable -> 502 with structured
//   body. The SDK and raw fetch wrapper throw ConnectionRefused /
//   ETIMEDOUT / etc. when the configured port is dead. Default Nitro
//   would return `{"error":true,"status":500,"unhandled":true}` which
//   the frontend cannot distinguish from a real internal error.
//   Rewrite to 502 with `{ error: "upstream-unreachable" }` so the
//   connection-monitor banner can fire and the user sees a friendly
//   message instead of an opaque 500. fetchOpencode also returns a
//   synthetic 502 on terminal failure, and sessions.ts may re-throw a
//   ConnectionRefused error to route through this handler; both paths
//   converge here so the response shape stays consistent.
//
//   Everything else -> default Nitro JSON error response.

const NETWORK_ERR_PATTERNS = [
  "ConnectionRefused",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "Unable to connect",
  "fetch failed",
];

function looksLikeUpstreamError(err: HTTPError): boolean {
  const code = (err as unknown as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_ERR_PATTERNS.includes(code)) {
    return true;
  }
  const cause = (err as unknown as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as { code?: unknown }).code;
    if (
      typeof causeCode === "string" &&
      NETWORK_ERR_PATTERNS.includes(causeCode)
    ) {
      return true;
    }
  }
  const message = err.message ?? "";
  return NETWORK_ERR_PATTERNS.some((p) => message.includes(p));
}

export default async function errorHandler(
  error: HTTPError,
  event: HTTPEvent,
  ctx: {
    defaultHandler: (
      error: HTTPError,
      event: HTTPEvent,
      opts?: { json?: boolean },
    ) => unknown;
  },
): Promise<unknown> {
  const path = (event as unknown as { path?: string }).path ?? "";

  if (path.startsWith("/assets/")) {
    setResponseStatus(event as never, 404);
    return null;
  }

  if (looksLikeUpstreamError(error) && path.startsWith("/api/opencode/")) {
    // Path shape: /api/opencode/<port>/...
    const m = /^\/api\/opencode\/(\d+)\b/.exec(path);
    const port = m ? Number(m[1]) : undefined;
    return new Response(
      JSON.stringify({
        error: "upstream-unreachable",
        message:
          "OpenCode at the configured endpoint did not respond. It may have stopped, restarted under a new port, or moved.",
        port,
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return ctx.defaultHandler(error, event, { json: true });
}
