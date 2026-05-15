import type { HTTPError, HTTPEvent } from "nitro/h3";

// Single Nitro errorHandler covering three distinct failure rewrites:
//
//   /assets/*.js missing -> 200 with reload shim. When the in-memory
//   asset manifest references a file that's gone from disk (deploy
//   race: browser cached `index.html` from build vN, server now
//   serves build vN+M which wiped the old hashed assets), the static
//   handler throws and lands here. Returning 404 (the previous
//   behaviour) was honest but useless - the browser's
//   <script type="module"> tag has no recovery path on 404, the page
//   crashes hard with a console error. We instead serve a 200 with a
//   tiny JS payload that triggers `window.location.reload()`, which
//   re-fetches `index.html` (uncached per route rule below). The new
//   HTML references the current build's asset hashes and the page
//   renders normally. SessionStorage guard prevents infinite reload
//   loops if the new HTML somehow still references a missing asset.
//
//   /assets/*.css missing -> 200 with empty body. Stylesheet links
//   don't trigger reloads (a missing style sheet just means an
//   unstyled page until the next navigation) so we just return an
//   empty CSS body. Same Cache-Control: no-store so the shim
//   doesn't get cached if the browser is being aggressive.
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

const MISSING_ASSET_JS_SHIM = `console.warn("[openportal] asset hash drift; reloading to pick up latest build");
(function () {
  var key = "openportal:reload-attempted";
  var now = Date.now();
  var last = parseInt(sessionStorage.getItem(key) || "0", 10);
  if (now - last < 5000) {
    console.error("[openportal] reload loop blocked - build may be broken");
    return;
  }
  sessionStorage.setItem(key, String(now));
  location.reload();
})();
`;

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
    if (path.endsWith(".js")) {
      return new Response(MISSING_ASSET_JS_SHIM, {
        status: 200,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }
    if (path.endsWith(".css")) {
      return new Response("/* openportal: asset missing, ignored */\n", {
        status: 200,
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }
    return new Response(null, { status: 404 });
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
