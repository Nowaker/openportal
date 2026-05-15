import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// OPENPORTAL_STATE_PATH overrides the default ~/.openportal-state.json
// so dev/sandbox instances keep their lastViewed/pinnedSessions/settings
// fully isolated from prod.
const STATE_FILE =
  process.env.OPENPORTAL_STATE_PATH && process.env.OPENPORTAL_STATE_PATH.length > 0
    ? process.env.OPENPORTAL_STATE_PATH
    : join(homedir(), ".openportal-state.json");

interface PortalState {
  lastViewed?: Record<string, number>;
  pinnedSessions?: string[];
  settings?: Record<string, unknown>;
}

let cache: PortalState | null = null;

function load(): PortalState {
  if (cache) return cache;
  if (!existsSync(STATE_FILE)) {
    cache = {};
    return cache;
  }
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cache = {};
  }
  return cache!;
}

function persist(state: PortalState) {
  cache = state;
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* best-effort: state is recoverable from session.time on next restart */
  }
}

export function getLastViewedMap(): Record<string, number> {
  return load().lastViewed ?? {};
}

export function setLastViewed(sessionId: string, ms: number): void {
  const state = load();
  const map = state.lastViewed ?? {};
  map[sessionId] = ms;
  persist({ ...state, lastViewed: map });
}

export function getPinnedSessions(): string[] {
  const list = load().pinnedSessions;
  return Array.isArray(list) ? list : [];
}

export function pinSession(sessionId: string): string[] {
  const state = load();
  const list = Array.isArray(state.pinnedSessions)
    ? state.pinnedSessions.filter((id) => id !== sessionId)
    : [];
  list.push(sessionId);
  persist({ ...state, pinnedSessions: list });
  return list;
}

export function unpinSession(sessionId: string): string[] {
  const state = load();
  const list = Array.isArray(state.pinnedSessions)
    ? state.pinnedSessions.filter((id) => id !== sessionId)
    : [];
  persist({ ...state, pinnedSessions: list });
  return list;
}

export function reorderPinnedSessions(order: string[]): string[] {
  const state = load();
  const known = new Set(
    Array.isArray(state.pinnedSessions) ? state.pinnedSessions : [],
  );
  const next = order.filter((id) => known.has(id));
  for (const id of known) {
    if (!next.includes(id)) next.push(id);
  }
  persist({ ...state, pinnedSessions: next });
  return next;
}

export function getSettings(): Record<string, unknown> {
  return load().settings ?? {};
}

export function setSetting(namespace: string, value: unknown): Record<string, unknown> {
  const state = load();
  const next: Record<string, unknown> = { ...(state.settings ?? {}) };
  if (value === null || value === undefined) {
    delete next[namespace];
  } else {
    next[namespace] = value;
  }
  persist({ ...state, settings: next });
  return next;
}
