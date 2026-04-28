import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

const NEW_CONFIG_PATH = join(homedir(), ".openportal.json");
const LEGACY_CONFIG_PATH = join(homedir(), ".portal.json");

export interface OpenPortalConfig {
  directories: string[];
}

interface RawConfig {
  directories?: string[];
}

interface LegacyConfig {
  instances?: { directory?: string }[];
}

/**
 * Drop entries that are subdirectories of a shallower entry already in the
 * list. The first occurrence (shallowest by depth) wins, matching the
 * user-stated rule: '~/projekty and ~/projekty/dupa should be rejected,
 * just go with ~/projekty'.
 */
function dedupeSubfolders(dirs: string[]): {
  kept: string[];
  dropped: { dir: string; reason: string }[];
} {
  const normalised = dirs
    .filter((d) => typeof d === "string" && d.length > 0)
    .map((d) => resolve(d));
  const sorted = [...new Set(normalised)].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  const kept: string[] = [];
  const dropped: { dir: string; reason: string }[] = [];
  for (const d of sorted) {
    const parent = kept.find((k) => d === k || d.startsWith(k + "/"));
    if (parent && parent !== d) {
      dropped.push({
        dir: d,
        reason: `subdirectory of '${parent}'`,
      });
    } else if (!kept.includes(d)) {
      kept.push(d);
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

  let directories: string[] = [];
  if (existsSync(NEW_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(
        readFileSync(NEW_CONFIG_PATH, "utf-8"),
      ) as RawConfig;
      directories = raw.directories ?? [];
    } catch (e) {
      console.warn(
        `[openportal-config] Failed to parse ${NEW_CONFIG_PATH}:`,
        e instanceof Error ? e.message : e,
      );
    }
  } else {
    directories = migrateFromLegacy();
    if (directories.length > 0) {
      const seeded: OpenPortalConfig = {
        directories: dedupeSubfolders(directories).kept,
      };
      try {
        writeFileSync(
          NEW_CONFIG_PATH,
          JSON.stringify(seeded, null, 2) + "\n",
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

  const { kept, dropped } = dedupeSubfolders(directories);
  if (dropped.length > 0 && !warnedAboutDrops) {
    for (const d of dropped) {
      console.warn(
        `[openportal-config] Dropped '${d.dir}': ${d.reason}.`,
      );
    }
    warnedAboutDrops = true;
  }
  cached = { directories: kept };
  return cached;
}

export function clearPortalConfigCache() {
  cached = null;
  warnedAboutDrops = false;
}
