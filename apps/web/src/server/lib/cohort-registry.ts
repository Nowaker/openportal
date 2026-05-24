// Cohort registry.
//
// Per the cohort-architecture dispatch: a "server" in the user-facing
// sense is a cohort = a logical group of opencode-serve INSTANCES that
// share the same SQLite DB. The stuck-detector plugin is the
// authoritative source of cohort membership: every opencode-serve that
// registered to the same plugin leader is by definition a member of the
// same cohort (sharing the same DB by construction).
//
// This module polls GET 127.0.0.1:4098/workers every COHORT_POLL_MS,
// caches the list in memory, and exposes the cohort + per-instance data
// to other portal subsystems (API endpoints, frontend stores).
//
// For the current single-plugin-leader setup, every worker returned by
// /workers belongs to the SAME cohort. Future per-cohort plugin URLs
// (per the dispatch's future-proofing section) will add a cohort-key
// keyed map of plugin URLs; for v1 we have a single anonymous cohort
// labeled by the plugin leader URL.

const PLUGIN_URL = "http://127.0.0.1:4098";
const COHORT_POLL_MS = 30_000;
const FETCH_TIMEOUT_MS = 2_500;

export interface CohortWorker {
  workerID: string;
  instanceUrl: string;
  host: string;
  port: number;
  lastSeen: number;
  ownBusyCount: number;
}

export interface CohortSnapshot {
  workers: CohortWorker[];
  fetchedAt: number;
  pluginReachable: boolean;
}

let cached: CohortSnapshot = {
  workers: [],
  fetchedAt: 0,
  pluginReachable: false,
};

interface RawWorker {
  workerID?: unknown;
  instanceUrl?: unknown;
  lastSeen?: unknown;
  ownBusy?: unknown;
}

function parseWorker(raw: RawWorker): CohortWorker | null {
  if (
    typeof raw.workerID !== "string" ||
    typeof raw.instanceUrl !== "string" ||
    typeof raw.lastSeen !== "number"
  ) {
    return null;
  }
  let host = "";
  let port = 0;
  try {
    const u = new URL(raw.instanceUrl);
    host = u.hostname;
    port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
  if (!Number.isFinite(port) || port <= 0) return null;
  let ownBusyCount = 0;
  if (raw.ownBusy && typeof raw.ownBusy === "object") {
    ownBusyCount = Object.keys(raw.ownBusy as Record<string, unknown>).length;
  }
  return {
    workerID: raw.workerID,
    instanceUrl: raw.instanceUrl,
    host,
    port,
    lastSeen: raw.lastSeen,
    ownBusyCount,
  };
}

async function fetchWorkers(): Promise<CohortSnapshot> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PLUGIN_URL}/workers`, { signal: ctrl.signal });
    if (!res.ok) {
      return {
        workers: cached.workers,
        fetchedAt: Date.now(),
        pluginReachable: false,
      };
    }
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) {
      return {
        workers: cached.workers,
        fetchedAt: Date.now(),
        pluginReachable: false,
      };
    }
    const workers: CohortWorker[] = [];
    for (const raw of body) {
      const w = parseWorker(raw as RawWorker);
      if (w) workers.push(w);
    }
    workers.sort((a, b) => a.instanceUrl.localeCompare(b.instanceUrl));
    return {
      workers,
      fetchedAt: Date.now(),
      pluginReachable: true,
    };
  } catch {
    return {
      workers: cached.workers,
      fetchedAt: Date.now(),
      pluginReachable: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function getCohortSnapshot(): CohortSnapshot {
  return cached;
}

export async function refreshCohortSnapshot(): Promise<CohortSnapshot> {
  cached = await fetchWorkers();
  return cached;
}

export function findCohortWorker(
  host: string,
  port: number,
): CohortWorker | null {
  return (
    cached.workers.find((w) => w.host === host && w.port === port) ?? null
  );
}

let pollerStarted = false;

export function startCohortPoller(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  void refreshCohortSnapshot();
  const timer = setInterval(() => void refreshCohortSnapshot(), COHORT_POLL_MS);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }
}
