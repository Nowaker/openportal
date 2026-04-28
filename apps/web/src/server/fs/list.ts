import { defineHandler, getQuery } from "nitro/h3";
import { readdir, lstat } from "fs/promises";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { readPortalConfig } from "../lib/portal-config";

function isUnderAny(target: string, bases: string[]): boolean {
  if (bases.length === 0) return true;
  return bases.some((b) => target === b || target.startsWith(b + "/"));
}

function isAncestorOfAny(target: string, bases: string[]): boolean {
  return bases.some((b) => b === target || b.startsWith(target + "/"));
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const config = readPortalConfig();
  const bases = config.directories;

  const rawPath = (query.path as string) || (bases[0] ?? homedir());

  let path: string;
  try {
    path = resolve(rawPath);
  } catch {
    return { error: "Invalid path", path: rawPath };
  }

  if (bases.length > 0 && !isUnderAny(path, bases)) {
    return {
      error: `Path is outside the configured base directories.`,
      path,
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
    .filter((e) => {
      if (bases.length === 0) return true;
      const candidate = path === "/" ? `/${e.name}` : `${path}/${e.name}`;
      return isUnderAny(candidate, bases) || isAncestorOfAny(candidate, bases);
    })
    .map((e) => ({ name: e.name, isDir: true }))
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
    entries,
  };
});
