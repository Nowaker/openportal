import {
  defineHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "nitro/h3";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

import { resolveScopedPath } from "../lib/fs-security";

// Inline-renderable images. Anything else falls through to
// application/octet-stream with attachment disposition so the browser
// downloads rather than tries to render unknown content as text.
const INLINE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

function mimeFor(filename: string): { mime: string; inline: boolean } {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return { mime: "application/octet-stream", inline: false };
  const ext = filename.slice(dot + 1).toLowerCase();
  const inline = INLINE_MIME[ext];
  if (inline) return { mime: inline, inline: true };
  return { mime: "application/octet-stream", inline: false };
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const rawPath = String(query.path ?? "");
  if (rawPath.length === 0) {
    setResponseStatus(event, 400);
    return "path query required";
  }
  const scope = resolveScopedPath(rawPath);
  if (!scope.ok) {
    setResponseStatus(event, 403);
    return scope.error ?? "denied";
  }
  const path = scope.path;
  let stat;
  try {
    stat = await lstat(path);
  } catch {
    setResponseStatus(event, 404);
    return "not found";
  }
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    setResponseStatus(event, 400);
    return "not a regular file";
  }
  const filename = path.split("/").pop() ?? "file";
  const { mime, inline } = mimeFor(filename);
  setResponseHeader(event, "Content-Type", mime);
  setResponseHeader(event, "Content-Length", String(stat.size));
  setResponseHeader(
    event,
    "Content-Disposition",
    inline
      ? `inline; filename="${filename.replace(/"/g, "")}"`
      : `attachment; filename="${filename.replace(/"/g, "")}"`,
  );
  return createReadStream(path);
});
