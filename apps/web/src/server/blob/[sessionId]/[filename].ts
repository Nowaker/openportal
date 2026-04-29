import { defineHandler, HTTPError } from "nitro/h3";
import { readBlob } from "../../lib/blob-cache";
import { parseRouteParam } from "../../lib/validation";

export default defineHandler((event) => {
  const sessionId = parseRouteParam(event, "sessionId");
  const filename = parseRouteParam(event, "filename");
  const blob = readBlob(sessionId, filename);
  if (!blob) {
    throw new HTTPError("blob not found", { status: 404 });
  }
  return new Response(new Uint8Array(blob.buf), {
    headers: {
      "Content-Type": blob.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
