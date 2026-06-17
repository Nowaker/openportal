import { defineHandler, getQuery } from "nitro/h3";
import { readdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

import { evaluateReadAccess } from "../lib/fs-security";
import { readPortalConfig } from "../lib/portal-config";

interface Entry {
  name: string;
  isDir: boolean;
  size?: number;
  // mtime as unix ms. Surfaced so the client can render a short
  // 'last-modified age' column (2d / 5m / ...) without a second
  // round-trip. Best-effort: any stat failure leaves this undefined.
  mtimeMs?: number;
}

// Recursive size computation for a directory tree. Symlinks are
// NOT followed (lstat naturally avoids that), so we cannot loop on
// self-referential symlinks. A global entry-count cap of 50_000
// stops runaway traversals on top-level paths like /; whichever
// directory was being processed when the cap is hit returns
// whatever bytes had accumulated so far, and remaining sibling
// directories receive size = undefined (not 0 - undefined
// communicates "did not finish counting").
//
// Cap is shared across all directories in a single browse request
// because the response object is the bounded resource, not any
// single directory.
const DIR_SIZE_ENTRY_CAP = 50_000;

interface DirSizeContext {
  entriesSeen: number;
  capHit: boolean;
}

async function computeDirSize(path: string, ctx: DirSizeContext): Promise<number | undefined> {
  if (ctx.capHit) return undefined;
  let total = 0;
  let raw;
  try {
    raw = await readdir(path, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of raw) {
    if (ctx.capHit) return undefined;
    ctx.entriesSeen += 1;
    if (ctx.entriesSeen > DIR_SIZE_ENTRY_CAP) {
      ctx.capHit = true;
      return undefined;
    }
    const child = `${path}/${entry.name}`;
    let stat;
    try {
      stat = await lstat(child);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Symlinks contribute their own link-bytes only, never the
      // target. lstat reports the link itself, so this is just
      // stat.size - tiny but real.
      total += stat.size;
      continue;
    }
    if (stat.isDirectory()) {
      const sub = await computeDirSize(child, ctx);
      if (typeof sub === "number") total += sub;
    } else if (stat.isFile()) {
      total += stat.size;
    }
  }
  return total;
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const config = readPortalConfig();
  const bases = config.directories;

  const rawPath = (query.path as string) || (bases[0] ?? homedir());
  const showHidden = query.show_hidden === "1" || query.show_hidden === "true";
  const withDirSize = query.with_dir_size === "1" || query.with_dir_size === "true";
  const access = await evaluateReadAccess(rawPath);
  if (access.decision === "deny") {
    return {
      error: access.error,
      path: access.path,
      parent: access.path === "/" ? null : dirname(access.path),
      home: homedir(),
    };
  }
  const path = access.path;

  // Legacy fail-closed mode (opencode permission config unavailable): keep the
  // prior base-directory behavior - a path above a base renders as a virtual
  // bridge listing only the bases beneath it; a path neither under nor an
  // ancestor of any base is rejected.
  if (
    access.decision === "legacy" &&
    bases.length > 0 &&
    access.insideBase === false
  ) {
    if (!access.isAncestor) {
      return { error: "Path is outside the configured base directories.", path };
    }
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

  const filtered = raw.filter((e) => {
    if (!e.isFile() && !e.isDirectory() && !e.isSymbolicLink()) return false;
    if (!showHidden && e.name.startsWith(".")) return false;
    return true;
  });

  const dirSizeCtx: DirSizeContext = { entriesSeen: 0, capHit: false };

  const entries: Entry[] = await Promise.all(
    filtered.map(async (e) => {
      const isDir = e.isDirectory();
      const entry: Entry = { name: e.name, isDir };
      const child = `${path}/${e.name}`;
      try {
        const s = await lstat(child);
        if (!isDir) entry.size = s.size;
        entry.mtimeMs = s.mtimeMs;
      } catch {
        /* stat is best-effort - column shows nothing on failure */
      }
      return entry;
    }),
  );

  if (withDirSize) {
    for (const entry of entries) {
      if (!entry.isDir) continue;
      const child = `${path}/${entry.name}`;
      const total = await computeDirSize(child, dirSizeCtx);
      if (typeof total === "number") entry.size = total;
    }
  }
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
