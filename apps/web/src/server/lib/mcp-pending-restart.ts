import { getSettings, setSetting } from "./portal-state";
import { readMcpMap, type McpMap } from "./mcp-config";

const NAMESPACE = "mcpRestartSnapshot";

interface SnapshotShape {
  snapshot: McpMap;
  capturedAt: string;
}

function readSnapshot(): SnapshotShape | null {
  const all = getSettings();
  const raw = all[NAMESPACE];
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const snap = obj.snapshot;
  const at = typeof obj.capturedAt === "string" ? obj.capturedAt : null;
  if (!snap || typeof snap !== "object" || !at) return null;
  return { snapshot: snap as McpMap, capturedAt: at };
}

export function captureRestartSnapshot(): SnapshotShape {
  const snapshot = readMcpMap();
  const capturedAt = new Date().toISOString();
  setSetting(NAMESPACE, { snapshot, capturedAt });
  return { snapshot, capturedAt };
}

export type MaybeSnapshot = SnapshotShape | { snapshot: null; capturedAt: null };

export function getOrInitSnapshot(): SnapshotShape {
  const existing = readSnapshot();
  if (existing) return existing;
  return captureRestartSnapshot();
}

function stableEntryHash(entry: unknown): string {
  return JSON.stringify(canonicalize(entry));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = canonicalize(obj[k]);
      return acc;
    }, {});
}

export interface PendingDiff {
  pending: boolean;
  current: McpMap;
  active: McpMap;
  capturedAt: string;
  diff: {
    added: string[];
    removed: string[];
    modified: string[];
  };
}

export function diffAgainstSnapshot(): PendingDiff {
  const { snapshot, capturedAt } = getOrInitSnapshot();
  const current = readMcpMap();
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const allKeys = new Set([...Object.keys(snapshot), ...Object.keys(current)]);
  for (const key of allKeys) {
    const inSnap = key in snapshot;
    const inCur = key in current;
    if (inSnap && !inCur) removed.push(key);
    else if (!inSnap && inCur) added.push(key);
    else if (stableEntryHash(snapshot[key]) !== stableEntryHash(current[key])) {
      modified.push(key);
    }
  }
  return {
    pending: added.length > 0 || removed.length > 0 || modified.length > 0,
    current,
    active: snapshot,
    capturedAt,
    diff: { added, removed, modified },
  };
}
