import { defineHandler, getQuery } from "nitro/h3";
import { lstat, stat as statFollow } from "node:fs/promises";

import { resolveScopedPath } from "../lib/fs-security";

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const rawPath = String(query.path ?? "");
  if (rawPath.length === 0) {
    return { exists: false, isDir: false, isFile: false };
  }
  const scope = resolveScopedPath(rawPath);
  if (!scope.ok) {
    return { exists: false, isDir: false, isFile: false };
  }
  try {
    const s = await lstat(scope.path);
    if (s.isSymbolicLink()) {
      try {
        const followed = await statFollow(scope.path);
        return {
          exists: true,
          isDir: followed.isDirectory(),
          isFile: followed.isFile(),
          path: scope.path,
        };
      } catch {
        return { exists: true, isDir: false, isFile: false, path: scope.path };
      }
    }
    return {
      exists: true,
      isDir: s.isDirectory(),
      isFile: s.isFile(),
      path: scope.path,
    };
  } catch {
    return { exists: false, isDir: false, isFile: false };
  }
});
