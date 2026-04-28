import { defineHandler } from "nitro/h3";
import { readdir, lstat } from "fs/promises";
import { resolve } from "path";
import { readPortalConfig } from "../lib/portal-config";

interface ScanResult {
  paths: string[];
  errors: { base: string; error: string }[];
}

async function listSubdirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const names: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        names.push(e.name);
        continue;
      }
      if (e.isSymbolicLink()) {
        try {
          const stat = await lstat(`${path}/${e.name}`);
          if (stat.isDirectory()) names.push(e.name);
        } catch {
        }
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function walkAtDepth(
  basePath: string,
  remainingDepth: number,
): Promise<string[]> {
  if (remainingDepth <= 0) return [basePath];
  const subs = await listSubdirs(basePath);
  if (subs.length === 0) return [];
  const out: string[] = [];
  for (const sub of subs) {
    const child = `${basePath}/${sub}`;
    const nested = await walkAtDepth(child, remainingDepth - 1);
    out.push(...nested);
  }
  return out;
}

export default defineHandler(async (): Promise<ScanResult> => {
  const config = readPortalConfig();
  const errors: { base: string; error: string }[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const base of config.baseDirs) {
    let stat;
    try {
      stat = await lstat(base.path);
    } catch (e) {
      errors.push({
        base: base.path,
        error: e instanceof Error ? e.message : "Cannot access base",
      });
      continue;
    }
    if (!stat.isDirectory()) {
      errors.push({ base: base.path, error: "Not a directory" });
      continue;
    }

    if (base.level <= 1) {
      const subs = await listSubdirs(base.path);
      for (const sub of subs) {
        const full = resolve(`${base.path}/${sub}`);
        if (!seen.has(full)) {
          seen.add(full);
          paths.push(full);
        }
      }
      continue;
    }

    const firstLevelSubs = await listSubdirs(base.path);
    for (const firstSeg of firstLevelSubs) {
      const firstPath = `${base.path}/${firstSeg}`;
      if (base.level1.includes(firstSeg)) {
        const full = resolve(firstPath);
        if (!seen.has(full)) {
          seen.add(full);
          paths.push(full);
        }
        continue;
      }
      const remaining = base.level - 1;
      const nested = await walkAtDepth(firstPath, remaining);
      for (const n of nested) {
        const full = resolve(n);
        if (!seen.has(full)) {
          seen.add(full);
          paths.push(full);
        }
      }
    }
  }

  paths.sort((a, b) => a.localeCompare(b));
  return { paths, errors };
});
