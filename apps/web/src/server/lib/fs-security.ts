import { realpathSync } from "fs";
import { homedir } from "os";
import { basename, relative, resolve } from "path";

import { readPortalConfig } from "./portal-config";
import {
  evaluateEffect,
  fetchReadPermissionConfig,
} from "./opencode-permissions";

// OpenPortal exposes two filesystem authorization models:
//
//   - WRITES (write/touch/mkdir) stay restricted to the configured base
//     directories via `resolveScopedPath`. Widening writes is out of scope.
//   - READS (browse/list/read/raw) defer to opencode's own permission model
//     via `evaluateReadAccess`: deny exactly what opencode would deny, treat
//     "ask" as allow (openportal is user-operated). When opencode's config
//     can't be fetched we fail CLOSED to the legacy base-directory allowlist.
//
// Path resolution + the base-directory predicates are shared by both models;
// they live here as the single source of truth (callers must not re-implement
// them).

export interface FsScopeResult {
  ok: boolean;
  path: string;
  error?: string;
  insideBase?: boolean;
}

export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

export function isUnderAny(target: string, bases: string[]): boolean {
  if (bases.length === 0) return true;
  return bases.some((b) => target === b || target.startsWith(b + "/"));
}

export function isAncestorOfAny(target: string, bases: string[]): boolean {
  if (target === "/") return bases.some((b) => b.startsWith("/"));
  return bases.some((b) => b.startsWith(target + "/"));
}

// The longest base directory that contains `target` (target === base or under
// it), or undefined when none does. Longest wins so a nested base maps a path
// to its closest project root, mirroring opencode's location resolution.
export function longestMatchingBase(
  target: string,
  bases: string[],
): string | undefined {
  let best: string | undefined;
  for (const b of bases) {
    if (target === b || target.startsWith(b + "/")) {
      if (!best || b.length > best.length) best = b;
    }
  }
  return best;
}

// Canonicalize a user-supplied path: expand ~, collapse . / .. , then resolve
// symlinks via realpath when the path exists. realpath BEFORE any authorization
// check closes a symlink-bypass hole - a symlink under a base pointing at a
// denied target is evaluated by its real location. Missing paths fall back to
// the lexical resolution (they can't leak content anyway).
export function canonicalizePath(rawPath: string): string {
  const resolved = resolve(expandTilde(rawPath));
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

// WRITE-side scoping (write/touch/mkdir). Unchanged: writes are confined to
// configured base directories regardless of opencode's read permissions.
export function resolveScopedPath(rawPath: string): FsScopeResult {
  const bases = readPortalConfig().directories;
  let canonical: string;
  try {
    canonical = resolve(expandTilde(rawPath));
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

export type ReadDecision = "allow" | "deny" | "legacy";

export interface ReadAccessResult {
  decision: ReadDecision;
  path: string;
  insideBase: boolean;
  isAncestor: boolean;
  error?: string;
}

// READ-side authorization. Mirrors opencode's permission model: a read is
// denied iff opencode's `read` rules (matched by project-relative path when
// inside a base, by basename otherwise - exactly how opencode's read tool
// builds its resource) OR its `external_directory` deny-list (matched against
// the absolute path, for paths outside every base) say "deny". "ask" and
// "allow" both pass (openportal is user-operated, so a prompt == allow).
//
// When opencode's permission config can't be fetched we return
// decision="legacy" so each endpoint can fail CLOSED to its prior
// base-directory scoping rather than fail open.
export async function evaluateReadAccess(
  rawPath: string,
): Promise<ReadAccessResult> {
  const bases = readPortalConfig().directories;
  let canonical: string;
  try {
    canonical = canonicalizePath(rawPath);
  } catch {
    return {
      decision: "deny",
      path: rawPath,
      insideBase: false,
      isAncestor: false,
      error: "Invalid path",
    };
  }

  const insideBase = isUnderAny(canonical, bases);
  const isAncestor = isAncestorOfAny(canonical, bases);
  const base = longestMatchingBase(canonical, bases);

  // Pass the containing base as the workspace directory so opencode merges in
  // that project's .opencode config; omit it for external paths (opencode then
  // uses its global config, which carries the secrets deny-list).
  const perm = await fetchReadPermissionConfig(insideBase ? base : undefined);
  if (!perm) {
    return { decision: "legacy", path: canonical, insideBase, isAncestor };
  }

  const readResource =
    insideBase && base
      ? relative(base, canonical).replace(/\\/g, "/") || "."
      : basename(canonical);
  const readEffect = evaluateEffect(readResource, perm.read, "allow");
  const externalEffect = insideBase
    ? "allow"
    : evaluateEffect(canonical, perm.externalDirectory, "ask");

  if (readEffect === "deny" || externalEffect === "deny") {
    return {
      decision: "deny",
      path: canonical,
      insideBase,
      isAncestor,
      error: "Reading this path is denied by opencode permissions.",
    };
  }
  return { decision: "allow", path: canonical, insideBase, isAncestor };
}
