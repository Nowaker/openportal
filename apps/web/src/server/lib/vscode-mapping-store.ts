// Per-requestor VSCode path-mapping store.
//
// Persists at ~/.openportal/openportal-vscode-mappings.json. The wire
// shape is keyed by REQUESTOR IP because that's what we can identify
// the client by from the HTTP layer (after X-Forwarded-For). For each
// requestor, a map of workspace-root path -> mapped path on that
// client's machine. Empty/missing entries mean the request comes from
// this machine (no mapping needed) or the user hasn't set up a
// mapping yet.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const MAPPING_FILE = join(
  homedir(),
  ".openportal",
  "openportal-vscode-mappings.json",
);

export interface RequestorMapping {
  [workspaceRoot: string]: string;
}

interface MappingFile {
  byRequestor: Record<string, RequestorMapping>;
}

function readAll(): MappingFile {
  if (!existsSync(MAPPING_FILE)) {
    return { byRequestor: {} };
  }
  try {
    const text = readFileSync(MAPPING_FILE, "utf-8");
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "byRequestor" in parsed &&
      typeof (parsed as { byRequestor: unknown }).byRequestor === "object"
    ) {
      return parsed as MappingFile;
    }
    return { byRequestor: {} };
  } catch {
    return { byRequestor: {} };
  }
}

function writeAll(data: MappingFile): void {
  try {
    writeFileSync(MAPPING_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch (e) {
    console.warn(
      "[vscode-mapping] write failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

export function getMappingFor(requestor: string): RequestorMapping {
  const all = readAll();
  return all.byRequestor[requestor] ?? {};
}

export function setMappingFor(
  requestor: string,
  mapping: RequestorMapping,
): void {
  const all = readAll();
  all.byRequestor[requestor] = mapping;
  writeAll(all);
}

export function applyMapping(
  absPath: string,
  mapping: RequestorMapping,
): string {
  const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const k of sortedKeys) {
    if (absPath === k) return mapping[k];
    if (absPath.startsWith(k + "/")) {
      return mapping[k] + absPath.slice(k.length);
    }
  }
  return absPath;
}
