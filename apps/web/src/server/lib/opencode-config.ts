import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const OPENCODE_CONFIG_PATH = join(homedir(), ".opencode", "opencode.json");

interface OpencodeConfig {
  plugin?: Array<string | [string, Record<string, unknown>]>;
  [k: string]: unknown;
}

function readConfig(): OpencodeConfig {
  if (!existsSync(OPENCODE_CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(OPENCODE_CONFIG_PATH, "utf-8")) as OpencodeConfig;
  } catch {
    return {};
  }
}

function pluginSpec(entry: string | [string, Record<string, unknown>]): string {
  return Array.isArray(entry) ? entry[0] : entry;
}

export function isCompanionInstalled(): boolean {
  const cfg = readConfig();
  const list = cfg.plugin ?? [];
  return list.some((entry) =>
    pluginSpec(entry).includes("openportal-companion-plugin"),
  );
}

export function installCompanionPlugin(pluginPath: string): {
  changed: boolean;
  configPath: string;
} {
  const cfg = readConfig();
  const list = cfg.plugin ?? [];
  if (list.some((entry) => pluginSpec(entry).includes("openportal-companion-plugin"))) {
    return { changed: false, configPath: OPENCODE_CONFIG_PATH };
  }
  const fileUrl = pluginPath.startsWith("file://")
    ? pluginPath
    : `file://${pluginPath}`;
  const next = [...list, fileUrl];
  cfg.plugin = next;
  mkdirSync(dirname(OPENCODE_CONFIG_PATH), { recursive: true });
  writeFileSync(
    OPENCODE_CONFIG_PATH,
    JSON.stringify(cfg, null, 2) + "\n",
    "utf-8",
  );
  return { changed: true, configPath: OPENCODE_CONFIG_PATH };
}
