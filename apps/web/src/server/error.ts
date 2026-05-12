import { setResponseStatus } from "nitro/h3";

// Custom Nitro error handler. We override the default 500-response
// behavior for two paths that benefit from a more honest status:
//
//   /assets/* - When the server's in-memory asset manifest references a
//   file that's gone from disk (deploy race: process started with build
//   vN, disk now has vN+1, the vN-hash file no longer exists), the
//   default static handler throws and the framework lands on 500. The
//   browser's <script> error handler treats 500 as "server failure"
//   instead of "asset missing", which means the inline recovery script
//   in index.html doesn't auto-reload as cleanly. Mapping these to 404
//   gives the inline script a clearer signal and matches what the user
//   would observe on any well-behaved CDN serving the same content.
//
//   Anything else - keeps the default Nitro JSON error response.
export default function (
  error: Error & { statusCode?: number },
  event: { path?: string },
): unknown {
  const path = event.path ?? "";
  if (path.startsWith("/assets/")) {
    setResponseStatus(event as never, 404);
    return null;
  }
  const status = typeof error.statusCode === "number" ? error.statusCode : 500;
  setResponseStatus(event as never, status);
  return {
    error: true,
    status,
    message: error.message || "Internal server error",
  };
}
