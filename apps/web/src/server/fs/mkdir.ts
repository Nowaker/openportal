import { defineHandler, readBody } from "nitro/h3";
import { mkdir } from "fs/promises";
import { resolve, normalize } from "path";
import { readPortalConfig } from "../lib/portal-config";

// Creates a new project directory inside one of the configured base dirs.
// The {parent} must be at-or-under a base dir; refuses anything else so the
// mkdir endpoint can't be abused to create directories outside Portal's
// declared workspace scope. {name} is sanitized to a single path segment
// (no slashes, no traversal). Returns the full path so the caller can
// trigger the new-session flow on it directly.
export default defineHandler(async (event) => {
  const config = readPortalConfig();
  const body = (await readBody(event)) as
    | { parent?: string; name?: string }
    | undefined;
  const parent = typeof body?.parent === "string" ? body.parent : "";
  const rawName = typeof body?.name === "string" ? body.name : "";

  if (!parent) throw new Error("parent required");
  const name = rawName.trim();
  if (!name) throw new Error("name required");
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("name must be a single path segment");
  }

  const parentNorm = normalize(parent);
  const inScope = config.baseDirs.some(
    (b) =>
      parentNorm === b.path || parentNorm.startsWith(b.path + "/"),
  );
  if (!inScope) {
    throw new Error("parent is outside any configured workspace");
  }

  const target = resolve(parentNorm, name);
  if (!target.startsWith(parentNorm + "/") && target !== parentNorm) {
    throw new Error("resolved path escapes parent");
  }

  await mkdir(target, { recursive: false });
  return { path: target };
});
