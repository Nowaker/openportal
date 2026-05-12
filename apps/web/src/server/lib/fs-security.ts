import { homedir } from "os";
import { resolve } from "path";

import { readPortalConfig } from "./portal-config";

// Configured base directories are the only filesystem regions the user
// has opted in to expose through openportal endpoints. Path resolution
// happens BEFORE this check, so `..` traversal collapses normally; we
// only need to verify the canonical path is under (or an ancestor of)
// one of the bases. Returning the canonical path is part of the
// contract - callers should never see the user's original input again.

export interface FsScopeResult {
  ok: boolean;
  path: string;
  error?: string;
  insideBase?: boolean;
}

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

export function resolveScopedPath(rawPath: string): FsScopeResult {
  const config = readPortalConfig();
  const bases = config.directories;
  const expanded = expandTilde(rawPath);
  let canonical: string;
  try {
    canonical = resolve(expanded);
  } catch {
    return { ok: false, path: rawPath, error: "Invalid path" };
  }
  if (bases.length === 0) {
    return { ok: true, path: canonical, insideBase: true };
  }
  if (isUnderAny(canonical, bases)) {
    return { ok: true, path: canonical, insideBase: true };
  }
  if (isAncestorOfAny(canonical, bases)) {
    return { ok: true, path: canonical, insideBase: false };
  }
  return {
    ok: false,
    path: canonical,
    error: "Path is outside the configured base directories.",
  };
}
