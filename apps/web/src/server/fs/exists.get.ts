import { defineHandler, getQuery } from "nitro/h3";
import { lstat, stat as statFollow } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Existence answers a disk question, NOT a portal-scope question.
// Markdown links to /home/user/.config/foo or other out-of-scope
// files still need to render as clickable - the file browser can
// surface the scope error when the user clicks. Bypassing
// resolveScopedPath here lets the markdown linker validate ANY
// path the user can stat as their own UID.
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const rawPath = String(query.path ?? "");
  if (rawPath.length === 0) {
    return { exists: false, isDir: false, isFile: false };
  }
  let canonical: string;
  try {
    canonical = resolve(expandTilde(rawPath));
  } catch {
    return { exists: false, isDir: false, isFile: false };
  }
  try {
    const s = await lstat(canonical);
    if (s.isSymbolicLink()) {
      try {
        const followed = await statFollow(canonical);
        return {
          exists: true,
          isDir: followed.isDirectory(),
          isFile: followed.isFile(),
          path: canonical,
        };
      } catch {
        return { exists: true, isDir: false, isFile: false, path: canonical };
      }
    }
    return {
      exists: true,
      isDir: s.isDirectory(),
      isFile: s.isFile(),
      path: canonical,
    };
  } catch {
    return { exists: false, isDir: false, isFile: false };
  }
});
