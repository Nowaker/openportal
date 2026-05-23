import { defineHandler, getQuery } from "nitro/h3";
import { readdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

import { resolveScopedPath } from "../lib/fs-security";
import { readPortalConfig } from "../lib/portal-config";

interface Entry {
  name: string;
  isDir: boolean;
  size?: number;
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const config = readPortalConfig();
  const bases = config.directories;

  const rawPath = (query.path as string) || (bases[0] ?? homedir());
  const showHidden = query.show_hidden === "1" || query.show_hidden === "true";
  const scope = resolveScopedPath(rawPath);
  if (!scope.ok) {
    return { error: scope.error, path: scope.path };
  }
  const path = scope.path;

  if (bases.length > 0 && scope.insideBase === false) {
    const stripPrefix = path === "/" ? 1 : path.length + 1;
    const virtual = bases
      .filter((b) =>
        path === "/" ? b.startsWith("/") : b.startsWith(path + "/"),
      )
      .map<Entry>((b) => ({ name: b.slice(stripPrefix), isDir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path === "/" ? null : dirname(path);
    return {
      path,
      parent,
      home: homedir(),
      entries: virtual,
      virtual: true as const,
    };
  }

  // Compute parent unconditionally so the client's Up + Root buttons
  // stay active even when the current path is a file, a missing path,
  // or a permission-denied path. Without this the buttons go inactive
  // and the user is stranded.
  const computedParent = path === "/" ? null : dirname(path);

  let stat;
  try {
    stat = await lstat(path);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Path not accessible",
      path,
      parent: computedParent,
      home: homedir(),
    };
  }

  // When the path points at a regular file (not a directory), return
  // an isFile marker so the client can route to the file viewer with
  // parent + filename split automatically. Lets the user paste a
  // file path into the address bar OR navigate via a /files?path=
  // link that has the filename embedded in path.
  if (!stat.isDirectory()) {
    return {
      isFile: true,
      path,
      parent: computedParent,
      filename: path.split("/").pop() ?? "",
      home: homedir(),
    };
  }

  let raw;
  try {
    raw = await readdir(path, { withFileTypes: true });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Cannot read directory",
      path,
    };
  }

  // Files included AND directories - the difference from /api/fs/list.
  // Hidden entries excluded by default to avoid drowning the tree in
  // .git, .vscode, etc.; show_hidden=1 query param flips that.
  const entries: Entry[] = await Promise.all(
    raw
      .filter((e) => {
        if (!e.isFile() && !e.isDirectory() && !e.isSymbolicLink()) return false;
        if (!showHidden && e.name.startsWith(".")) return false;
        return true;
      })
      .map(async (e) => {
        const isDir = e.isDirectory();
        const entry: Entry = { name: e.name, isDir };
        if (!isDir) {
          try {
            const s = await lstat(`${path}/${e.name}`);
            entry.size = s.size;
          } catch {
            /* size is best-effort */
          }
        }
        return entry;
      }),
  );
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = path === "/" ? null : dirname(path);
  return {
    path,
    parent,
    home: homedir(),
    entries,
  };
});
