import { defineHandler, getQuery } from "nitro/h3";
import { readdir, lstat } from "fs/promises";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { readPortalConfig } from "../lib/portal-config";

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

function isUnderAny(target: string, bases: string[]): boolean {
  if (bases.length === 0) return true;
  return bases.some((b) => target === b || target.startsWith(b + "/"));
}

function isAncestorOfAny(target: string, bases: string[]): boolean {
  if (target === "/") return bases.some((b) => b.startsWith("/"));
  return bases.some((b) => b.startsWith(target + "/"));
}

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const config = readPortalConfig();
  const bases = config.directories;

  const rawPath = (query.path as string) || (bases[0] ?? homedir());
  const expanded = expandTilde(rawPath);

  let path: string;
  try {
    path = resolve(expanded);
  } catch {
    return { error: "Invalid path", path: rawPath };
  }

  if (
    bases.length > 0 &&
    !isUnderAny(path, bases) &&
    !isAncestorOfAny(path, bases)
  ) {
    return {
      error: `Path is outside the configured base directories.`,
      path,
    };
  }

  const inside = isUnderAny(path, bases);

  if (!inside && bases.length > 0) {
    const stripPrefix = path === "/" ? 1 : path.length + 1;
    const isUnderTarget = (b: string) =>
      path === "/" ? b.startsWith("/") : b.startsWith(path + "/");
    const virtual = bases
      .filter(isUnderTarget)
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
