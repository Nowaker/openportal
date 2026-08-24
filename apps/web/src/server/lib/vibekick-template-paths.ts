import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { FsTemplate } from "../../lib/vibekick-template-contract";

export type TemplateLocationValidation =
  | { readonly ok: true; readonly workspaceRoot: string }
  | { readonly ok: false; readonly reason: string };

export function expandTemplatePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return resolve(expandTemplatePath(workspaceRoot));
}

export function normalizeWorkspaceRoots(
  workspaceRoots: readonly string[],
): string[] {
  return Array.from(new Set(workspaceRoots.map(normalizeWorkspaceRoot)));
}

export function isPathWithin(path: string, directory: string): boolean {
  const resolvedPath = normalizeWorkspaceRoot(path);
  const resolvedDirectory = normalizeWorkspaceRoot(directory);
  return (
    resolvedPath === resolvedDirectory ||
    resolvedPath.startsWith(resolvedDirectory + sep)
  );
}

export function resolveWorkspaceRoot(
  directory: string,
  workspaceRoots: readonly string[],
): string {
  const resolvedDirectory = normalizeWorkspaceRoot(directory);
  return (
    findWorkspaceRoot(resolvedDirectory, workspaceRoots) ?? resolvedDirectory
  );
}

function findWorkspaceRoot(
  location: string,
  workspaceRoots: readonly string[],
): string | null {
  let bestMatch: string | null = null;
  for (const workspaceRoot of workspaceRoots) {
    const resolvedRoot = normalizeWorkspaceRoot(workspaceRoot);
    if (
      isPathWithin(location, resolvedRoot) &&
      (!bestMatch || resolvedRoot.length > bestMatch.length)
    ) {
      bestMatch = resolvedRoot;
    }
  }
  return bestMatch;
}

export function templateScope(location: string, workspaceRoot: string): string {
  const scope = relative(workspaceRoot, location);
  return scope.startsWith("..") ? location : scope;
}

export function rehomeFsTemplate(
  template: FsTemplate,
  workspaceRoots: readonly string[],
): FsTemplate | null {
  const workspaceRoot = findWorkspaceRoot(template.location, workspaceRoots);
  if (!workspaceRoot) return null;
  return {
    ...template,
    workspaceRoot,
    scope: templateScope(template.location, workspaceRoot),
  };
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function resolveRealPathWithMissingLeaf(path: string): string {
  const target = normalizeWorkspaceRoot(path);
  let existingPath = target;
  while (true) {
    try {
      return resolve(
        realpathSync(existingPath),
        relative(existingPath, target),
      );
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(existingPath);
      if (parent === existingPath) throw error;
      existingPath = parent;
    }
  }
}

export function validateTemplateLocation(
  location: string,
  workspaceRoots: readonly string[],
): TemplateLocationValidation {
  const expanded = normalizeWorkspaceRoot(location);
  if (!/\.md$/i.test(expanded)) {
    return { ok: false, reason: "Template path must end in .md" };
  }
  const parent = dirname(expanded);
  if (!parent.endsWith(`${sep}.vibekick${sep}templates`)) {
    return {
      ok: false,
      reason: "Template path must live under .vibekick/templates/",
    };
  }
  const workspaceRoot = findWorkspaceRoot(expanded, workspaceRoots);
  if (!workspaceRoot) {
    return {
      ok: false,
      reason: "Template path is not inside any configured workspace root",
    };
  }
  try {
    const realLocation = resolveRealPathWithMissingLeaf(expanded);
    const realWorkspaceRoot = resolveRealPathWithMissingLeaf(workspaceRoot);
    if (!isPathWithin(realLocation, realWorkspaceRoot)) {
      return {
        ok: false,
        reason: "Template path resolves outside its configured workspace root",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "Template path could not be resolved safely",
    };
  }
  return { ok: true, workspaceRoot };
}
