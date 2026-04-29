import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const STATE_FILE = join(homedir(), ".openportal-state.json");

interface PortalState {
  lastViewed?: Record<string, number>;
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
