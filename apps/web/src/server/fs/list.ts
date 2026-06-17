import { defineHandler, getQuery } from "nitro/h3";
import { readdir, lstat } from "fs/promises";
import { dirname } from "path";
import { homedir } from "os";
import { readPortalConfig } from "../lib/portal-config";
import {
  evaluateReadAccess,
  isAncestorOfAny,
  isUnderAny,
} from "../lib/fs-security";

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const bases = readPortalConfig().directories;
  const rawPath = (query.path as string) || (bases[0] ?? homedir());

  const access = await evaluateReadAccess(rawPath);
  if (access.decision === "deny") {
    return { error: access.error, path: access.path };
  }
  const path = access.path;

  // Legacy fail-closed mode (opencode permission config unavailable): keep the
  // prior base-directory behavior - a path above a base renders as a virtual
  // bridge listing only the bases beneath it; a path neither under nor an
  // ancestor of any base is rejected.
  if (access.decision === "legacy" && bases.length > 0 && !access.insideBase) {
    if (!access.isAncestor) {
      return { error: "Path is outside the configured base directories.", path };
    }
    const stripPrefix = path === "/" ? 1 : path.length + 1;
    const virtual = bases
      .filter((b) => (path === "/" ? b.startsWith("/") : b.startsWith(path + "/")))
      .map((b) => ({ name: b.slice(stripPrefix), isDir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path === "/" ? null : dirname(path);
    const parentInScope =
      parent === null
        ? null
        : isUnderAny(parent, bases) || isAncestorOfAny(parent, bases)
          ? parent
          : null;

    return {
      path,
      parent: parentInScope,
      home: homedir(),
      entries: virtual,
      virtual: true as const,
    };
  }

  let stat;
  try {
    stat = await lstat(path);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Path not accessible",
      path,
    };
  }

  if (!stat.isDirectory()) {
    return { error: "Not a directory", path };
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

  const entries = raw
    .filter((e) => {
      if (!e.isDirectory() && !e.isSymbolicLink()) return false;
      if (e.name.startsWith(".")) return false;
      return true;
    })
    .map((e) => ({ name: e.name, isDir: true }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // In allow mode the parent is freely navigable ("read anywhere"); in legacy
  // mode keep it scoped to the bases so the picker can't walk above the
  // allowlist.
  const parent = path === "/" ? null : dirname(path);
  const parentScoped =
    access.decision === "legacy"
      ? parent === null
        ? null
        : isUnderAny(parent, bases) || isAncestorOfAny(parent, bases)
          ? parent
          : null
      : parent;

  return {
    path,
    parent: parentScoped,
    home: homedir(),
    entries,
  };
});
