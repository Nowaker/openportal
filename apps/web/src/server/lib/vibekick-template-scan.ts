import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import {
  sortFsTemplates,
  type FsTemplate,
} from "../../lib/vibekick-template-contract";
import {
  readTemplatesAtDirectory,
  TemplateFileAccessError,
} from "./vibekick-template-files";
import {
  isPathWithin,
  normalizeWorkspaceRoot,
  normalizeWorkspaceRoots,
} from "./vibekick-template-paths";

export type TemplateScanBatch = {
  readonly depth: number;
  readonly templates: readonly FsTemplate[];
  readonly unreadableDirectories: readonly string[];
};

export class TemplateScanTraversalError extends Error {
  override readonly name = "TemplateScanTraversalError";

  constructor(
    readonly directory: string,
    cause: unknown,
  ) {
    super(`Unable to scan filesystem template directory: ${directory}`, {
      cause,
    });
  }
}

type QueueEntry = {
  readonly directory: string;
  readonly workspaceRoot: string;
  readonly depth: number;
};

type ScanState = {
  readonly queue: QueueEntry[];
  readonly configuredRoots: ReadonlySet<string>;
  readonly strict: boolean;
  cursor: number;
};

const SCAN_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  ".nuxt",
  ".cache",
  ".output",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);
const DIRECTORIES_PER_YIELD = 64;

export function canonicalWorkspaceKey(workspaces: readonly string[]): string {
  return JSON.stringify(normalizeWorkspaceRoots(workspaces));
}

function createScanState(
  workspaces: readonly string[],
  strict: boolean,
): ScanState {
  const roots = normalizeWorkspaceRoots(workspaces);
  const queue: QueueEntry[] = [];
  for (const root of roots) {
    try {
      if (!existsSync(root) || !statSync(root).isDirectory()) {
        if (strict) throw new TemplateScanTraversalError(root, null);
        continue;
      }
    } catch (error) {
      if (strict) {
        throw error instanceof TemplateScanTraversalError
          ? error
          : new TemplateScanTraversalError(root, error);
      }
      continue;
    }
    queue.push({ directory: root, workspaceRoot: root, depth: 0 });
  }
  return {
    queue,
    configuredRoots: new Set(roots),
    strict,
    cursor: 0,
  };
}

function readDirectoryEntries(directory: string): {
  readonly entries: readonly Dirent[];
  readonly error: unknown | null;
} {
  try {
    return {
      entries: readdirSync(directory, { withFileTypes: true }).sort(
        (left, right) => left.name.localeCompare(right.name),
      ),
      error: null,
    };
  } catch (error) {
    return { entries: [], error };
  }
}

function scanNextDirectory(state: ScanState): TemplateScanBatch | null {
  const entry = state.queue[state.cursor];
  if (!entry) return null;
  state.cursor += 1;
  const directoryRead = readDirectoryEntries(entry.directory);
  if (directoryRead.error) {
    if (state.strict && state.configuredRoots.has(entry.directory)) {
      throw new TemplateScanTraversalError(
        entry.directory,
        directoryRead.error,
      );
    }
    return {
      depth: entry.depth,
      templates: [],
      unreadableDirectories: [entry.directory],
    };
  }
  let hasTemplateDirectory = false;
  for (const child of directoryRead.entries) {
    if (child.name === ".vibekick") {
      hasTemplateDirectory = child.isDirectory() && !child.isSymbolicLink();
      continue;
    }
    if (
      child.isSymbolicLink() ||
      !child.isDirectory() ||
      SCAN_SKIP_DIRS.has(child.name)
    ) {
      continue;
    }
    const childDirectory = join(entry.directory, child.name);
    if (
      childDirectory !== entry.workspaceRoot &&
      state.configuredRoots.has(childDirectory)
    ) {
      continue;
    }
    state.queue.push({
      directory: childDirectory,
      workspaceRoot: entry.workspaceRoot,
      depth: entry.depth + 1,
    });
  }
  try {
    return {
      depth: entry.depth,
      templates: hasTemplateDirectory
        ? readTemplatesAtDirectory(entry.directory, entry.workspaceRoot)
        : [],
      unreadableDirectories: [],
    };
  } catch (error) {
    if (!(error instanceof TemplateFileAccessError)) throw error;
    return {
      depth: entry.depth,
      templates: [],
      unreadableDirectories: [join(entry.directory, ".vibekick", "templates")],
    };
  }
}

export function scanWorkspaceTemplates(workspaceRoot: string): FsTemplate[] {
  const state = createScanState([workspaceRoot], false);
  const templates: FsTemplate[] = [];
  for (
    let batch = scanNextDirectory(state);
    batch;
    batch = scanNextDirectory(state)
  ) {
    templates.push(...batch.templates);
  }
  return sortFsTemplates(templates);
}

export async function* scanWorkspaceTemplateBatches(
  workspaces: readonly string[],
): AsyncGenerator<TemplateScanBatch> {
  const state = createScanState(workspaces, true);
  let directoriesSinceYield = 0;
  for (
    let batch = scanNextDirectory(state);
    batch;
    batch = scanNextDirectory(state)
  ) {
    const emitted =
      batch.templates.length > 0 || batch.unreadableDirectories.length > 0;
    if (emitted) yield batch;
    directoriesSinceYield += 1;
    if (emitted || directoriesSinceYield >= DIRECTORIES_PER_YIELD) {
      directoriesSinceYield = 0;
      await yieldToEventLoop();
    }
  }
}

export function templatesForDirectory(
  directory: string,
  workspaceRoot: string,
): FsTemplate[] {
  const resolvedDirectory = normalizeWorkspaceRoot(directory);
  const resolvedRoot = normalizeWorkspaceRoot(workspaceRoot);
  if (!existsSync(resolvedDirectory)) return [];
  if (!isPathWithin(resolvedDirectory, resolvedRoot)) {
    return [];
  }
  const templates: FsTemplate[] = [];
  let cursor = resolvedDirectory;
  while (true) {
    templates.push(...readTemplatesAtDirectory(cursor, resolvedRoot));
    if (cursor === resolvedRoot) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return sortFsTemplates(templates);
}
