import {
  defineHandler,
  readBody,
  setResponseStatus,
} from "nitro/h3";
import { lstat, writeFile } from "node:fs/promises";

import { resolveScopedPath } from "../lib/fs-security";

interface WriteBody {
  path?: unknown;
  content?: unknown;
}

const MAX_BYTES = 10 * 1024 * 1024;

export default defineHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as WriteBody | null;
  const rawPath = typeof body?.path === "string" ? body.path : "";
  const content = typeof body?.content === "string" ? body.content : null;
  if (rawPath.length === 0) {
    setResponseStatus(event, 400);
    return { error: "path required" };
  }
  if (content === null) {
    setResponseStatus(event, 400);
    return { error: "content (string) required" };
  }
  if (rawPath.includes("\0")) {
    setResponseStatus(event, 400);
    return { error: "path contains null byte" };
  }
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength > MAX_BYTES) {
    setResponseStatus(event, 413);
    return {
      error: `content too large (${byteLength} bytes, max ${MAX_BYTES})`,
    };
  }
  const scope = resolveScopedPath(rawPath);
  if (!scope.ok || !scope.insideBase) {
    setResponseStatus(event, 403);
    return {
      error:
        scope.error ?? "Path must resolve inside a configured base directory",
    };
  }
  try {
    const stat = await lstat(scope.path).catch(() => null);
    if (stat && !stat.isFile()) {
      setResponseStatus(event, 409);
      return { error: "Target exists and is not a regular file" };
    }
    await writeFile(scope.path, content, "utf8");
    return { path: scope.path, bytes: byteLength };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EACCES" || code === "EPERM") {
      setResponseStatus(event, 403);
      return { error: "Permission denied", path: scope.path };
    }
    if (code === "ENOENT") {
      setResponseStatus(event, 404);
      return { error: "Parent directory does not exist", path: scope.path };
    }
    setResponseStatus(event, 500);
    return {
      error: err instanceof Error ? err.message : "Write failed",
      path: scope.path,
    };
  }
});
