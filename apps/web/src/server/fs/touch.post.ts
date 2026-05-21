import {
  defineHandler,
  readBody,
  setResponseStatus,
} from "nitro/h3";
import { open } from "node:fs/promises";

import { resolveScopedPath } from "../lib/fs-security";

interface TouchBody {
  path?: unknown;
}

export default defineHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as TouchBody | null;
  const rawPath = typeof body?.path === "string" ? body.path : "";
  if (rawPath.length === 0) {
    setResponseStatus(event, 400);
    return { error: "path required" };
  }
  if (rawPath.includes("\0")) {
    setResponseStatus(event, 400);
    return { error: "path contains null byte" };
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
    const handle = await open(scope.path, "wx");
    await handle.close();
    return { path: scope.path };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EEXIST") {
      setResponseStatus(event, 409);
      return { error: "Already exists", path: scope.path };
    }
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
      error: err instanceof Error ? err.message : "touch failed",
      path: scope.path,
    };
  }
});
