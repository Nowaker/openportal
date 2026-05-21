import {
  defineHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "nitro/h3";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

import { resolveScopedPath } from "../lib/fs-security";

// Inline-renderable media. Anything else falls through to
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

// Extensions that should render inline as text/plain in the browser
// when "Raw" is clicked (instead of being force-downloaded).
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "json", "jsonc", "yaml", "yml",
  "toml", "ini", "conf", "cfg", "env", "xml", "html", "htm", "css",
  "scss", "sass", "less", "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp",
  "hpp", "cc", "cs", "php", "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql", "proto", "lua", "pl", "r", "scala",
  "clj", "ex", "exs", "erl", "hs", "elm", "dart", "vue", "svelte",
  "dockerignore", "gitignore", "editorconfig",
]);

const TEXT_FILENAMES = new Set([
  "LICENSE", "COPYING", "NOTICE", "AUTHORS", "CONTRIBUTORS",
  "README", "CHANGELOG", "Makefile", "GNUmakefile", "Dockerfile",
  "PKGBUILD", "Gemfile", "Rakefile", "Vagrantfile", "Procfile",
]);

function mimeFor(filename: string): { mime: string; inline: boolean } {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) {
    if (TEXT_FILENAMES.has(filename)) {
      return { mime: "text/plain; charset=utf-8", inline: true };
    }
    return { mime: "application/octet-stream", inline: false };
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  const inline = INLINE_MIME[ext];
  if (inline) return { mime: inline, inline: true };
  if (TEXT_EXTENSIONS.has(ext)) {
    return { mime: "text/plain; charset=utf-8", inline: true };
  }
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
  const forceDownload = query.download === "1" || query.download === "true";
  setResponseHeader(event, "Content-Type", mime);
  setResponseHeader(event, "Content-Length", String(stat.size));
  setResponseHeader(
    event,
    "Content-Disposition",
    inline && !forceDownload
      ? `inline; filename="${filename.replace(/"/g, "")}"`
      : `attachment; filename="${filename.replace(/"/g, "")}"`,
  );
  return createReadStream(path);
});
