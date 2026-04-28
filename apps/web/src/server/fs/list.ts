import { defineHandler, getQuery } from "nitro/h3";
import { readdir, lstat } from "fs/promises";
import { resolve, dirname } from "path";
import { homedir } from "os";

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const rawPath = (query.path as string) || homedir();

  let path: string;
  try {
    path = resolve(rawPath);
  } catch {
    return { error: "Invalid path", path: rawPath };
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

  return {
    path,
    parent: path === "/" ? null : dirname(path),
    home: homedir(),
    entries,
  };
});
