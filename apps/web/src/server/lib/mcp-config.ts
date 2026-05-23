import {
  OPENCODE_CONFIG_PATH,
  readOpencodeConfig,
  writeOpencodeConfig,
} from "./opencode-config";

export interface McpEntry {
  type?: "local" | "remote" | string;
  enabled?: boolean;
  url?: string;
  command?: string[];
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  env?: Record<string, string>;
  [k: string]: unknown;
}

export type McpMap = Record<string, McpEntry>;

export function readMcpMap(): McpMap {
  const cfg = readOpencodeConfig();
  const mcp = cfg.mcp;
  if (!mcp || typeof mcp !== "object") return {};
  return mcp as McpMap;
}

export function readMcpEntry(name: string): McpEntry | null {
  const map = readMcpMap();
  const entry = map[name];
  return entry && typeof entry === "object" ? entry : null;
}

export interface WriteResult {
  ok: boolean;
  configPath: string;
  changed: boolean;
  error?: string;
}

export function writeMcpEntry(name: string, entry: McpEntry | null): WriteResult {
  if (!name || typeof name !== "string") {
    return { ok: false, configPath: OPENCODE_CONFIG_PATH, changed: false, error: "name required" };
  }
  const cfg = readOpencodeConfig();
  const map = (cfg.mcp && typeof cfg.mcp === "object" ? cfg.mcp : {}) as McpMap;
  const before = JSON.stringify(map[name]);
  if (entry === null) {
    delete map[name];
  } else {
    map[name] = entry;
  }
  const after = JSON.stringify(map[name]);
  cfg.mcp = map;
  try {
    writeOpencodeConfig(cfg);
  } catch (e) {
    return {
      ok: false,
      configPath: OPENCODE_CONFIG_PATH,
      changed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  return {
    ok: true,
    configPath: OPENCODE_CONFIG_PATH,
    changed: before !== after,
  };
}
