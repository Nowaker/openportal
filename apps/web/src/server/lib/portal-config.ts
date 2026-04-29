import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

const NEW_CONFIG_PATH = join(homedir(), ".openportal.json");
const LEGACY_CONFIG_PATH = join(homedir(), ".portal.json");

// JSONC stripper. String-aware so `//` inside `"http://..."` is preserved.
// Mirror of the helper in packages/cli/src/index.ts; keep them in sync.
function stripJsoncComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = src[i];
        out += ch;
        if (ch === "\\" && i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (ch === '"') break;
      }
    } else if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export interface BaseDirEntry {
  path: string;
  level: number;
  level1: string[];
}

export interface ConfigDrop {
  path: string;
  reason: string;
}

export interface OpenPortalConfig {
  directories: string[];
  baseDirs: BaseDirEntry[];
  drops: ConfigDrop[];
}

interface RawConfigEntryObject {
  path?: string;
  level?: number;
  level1?: string[];
}

interface RawConfig {
  directories?: Array<string | RawConfigEntryObject>;
}

interface LegacyConfig {
  instances?: { directory?: string }[];
}

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

function normaliseEntry(
  raw: string | RawConfigEntryObject,
): BaseDirEntry | null {
  if (typeof raw === "string") {
    const path = resolve(expandTilde(raw));
    if (!path) return null;
    return { path, level: 1, level1: [] };
  }
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.path !== "string" || !raw.path) return null;
  const path = resolve(expandTilde(raw.path));
  const level =
    typeof raw.level === "number" && Number.isInteger(raw.level) && raw.level >= 1
      ? raw.level
      : 1;
  const level1 = Array.isArray(raw.level1)
    ? raw.level1.filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];
  return { path, level, level1 };
}

function dedupeSubfolders(entries: BaseDirEntry[]): {
  kept: BaseDirEntry[];
  dropped: { entry: BaseDirEntry; reason: string }[];
} {
  const sorted = [...entries].sort(
    (a, b) =>
      a.path.split("/").length - b.path.split("/").length ||
      a.path.localeCompare(b.path),
  );
  const kept: BaseDirEntry[] = [];
  const dropped: { entry: BaseDirEntry; reason: string }[] = [];
  const seenPaths = new Set<string>();
  for (const e of sorted) {
    if (seenPaths.has(e.path)) continue;
    const parent = kept.find(
      (k) => e.path !== k.path && e.path.startsWith(k.path + "/"),
    );
    if (parent) {
      dropped.push({
        entry: e,
        reason: `subdirectory of '${parent.path}'`,
      });
    } else {
      kept.push(e);
      seenPaths.add(e.path);
    }
  }
  return { kept, dropped };
}

function migrateFromLegacy(): string[] {
  if (!existsSync(LEGACY_CONFIG_PATH)) return [];
  try {
    const raw = JSON.parse(
      readFileSync(LEGACY_CONFIG_PATH, "utf-8"),
    ) as LegacyConfig;
    return (raw.instances ?? [])
      .map((i) => i.directory)
      .filter((d): d is string => typeof d === "string" && d.length > 0);
  } catch {
    return [];
  }
}

let cached: OpenPortalConfig | null = null;
let warnedAboutDrops = false;

export function readPortalConfig(): OpenPortalConfig {
  if (cached) return cached;

  let rawEntries: Array<string | RawConfigEntryObject> = [];
  if (existsSync(NEW_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(
        stripJsoncComments(readFileSync(NEW_CONFIG_PATH, "utf-8")),
      ) as RawConfig;
      rawEntries = raw.directories ?? [];
    } catch (e) {
      console.warn(
        `[openportal-config] Failed to parse ${NEW_CONFIG_PATH}:`,
        e instanceof Error ? e.message : e,
      );
    }
  } else {
    const legacy = migrateFromLegacy();
    if (legacy.length > 0) {
      rawEntries = legacy;
      const seeded = legacy;
      try {
        writeFileSync(
          NEW_CONFIG_PATH,
          JSON.stringify({ directories: seeded }, null, 2) + "\n",
          "utf-8",
        );
        console.log(
          `[openportal-config] Seeded ${NEW_CONFIG_PATH} from legacy ${LEGACY_CONFIG_PATH}`,
        );
      } catch (e) {
        console.warn(
          `[openportal-config] Could not write seed config:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  const parsed: BaseDirEntry[] = [];
  for (const raw of rawEntries) {
    const e = normaliseEntry(raw);
    if (e) parsed.push(e);
  }

  const { kept, dropped } = dedupeSubfolders(parsed);
  if (dropped.length > 0 && !warnedAboutDrops) {
    for (const d of dropped) {
      console.warn(
        `[openportal-config] Dropped '${d.entry.path}': ${d.reason}.`,
      );
    }
    warnedAboutDrops = true;
  }

  cached = {
    directories: kept.map((e) => e.path),
    baseDirs: kept,
    drops: dropped.map((d) => ({ path: d.entry.path, reason: d.reason })),
  };
  return cached;
}

export function clearPortalConfigCache() {
  cached = null;
  warnedAboutDrops = false;
}

/**
 * Compute the project key under which to group a session in the sidebar.
 * Honors per-base-dir level config and level1 exceptions.
 *
 * Examples (base = /home/u/projekty, level=2, level1=['ai-workspace']):
 *   /home/u/projekty/dreamhost/foo/bar   -> /home/u/projekty/dreamhost/foo
 *   /home/u/projekty/ai-workspace/sub    -> /home/u/projekty/ai-workspace
 *   /home/u/projekty/standalone          -> /home/u/projekty/standalone
 */
export function resolveProjectPath(
  sessionDir: string,
  baseDirs: BaseDirEntry[],
): string {
  const normalised = resolve(sessionDir);
  for (const base of baseDirs) {
    if (normalised === base.path) return normalised;
    if (!normalised.startsWith(base.path + "/")) continue;
    const rel = normalised.slice(base.path.length + 1);
    const parts = rel.split("/");
    if (parts.length === 0) return base.path;
    const firstSegment = parts[0];
    const effectiveLevel = base.level1.includes(firstSegment) ? 1 : base.level;
    const projectParts = parts.slice(0, effectiveLevel);
    return base.path + "/" + projectParts.join("/");
  }
  return normalised;
}
