import { homedir } from "node:os";
import { join } from "node:path";
import { getPluginInfo, type PluginInfo } from "./plugin-info";
import { nodePluginFs } from "./plugin-info/fs-node";
import { getInstanceDirectory, getOpencodeClientV2 } from "./opencode-client";

// Plugin metadata is essentially static between server upgrades. Sources of
// change: (a) user upgrades the npm package, (b) user edits the local plugin
// source, (c) user adds/removes a plugin from opencode config. (a)+(b) need
// the manual refresh button on the modal; (c) is caught by the LRU evict
// when the spec list changes plus the per-port prefetch on first hamburger
// open. 7-day TTL matches the MCP cache.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

interface CacheEntry {
  info: PluginInfo;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PluginInfo>>();
const prefetchedForPort = new Set<number>();

function evictIfFull(): void {
  if (cache.size < MAX_ENTRIES) return;
  // Map preserves insertion order, so the first key is the oldest. With
  // touch-on-read promotion below, this becomes a true LRU.
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

function buildResolutionRoots(port: number): {
  nodeModulesRoots: string[];
  packageCacheRoots: string[];
} {
  const nodeModulesRoots: string[] = [];
  const home = homedir();
  const projectDir = getInstanceDirectory(port);
  if (projectDir) nodeModulesRoots.push(join(projectDir, "node_modules"));
  nodeModulesRoots.push(join(home, ".opencode", "plugin", "node_modules"));
  // Portal's own deps as a last-resort fallback so things like @opencode-ai/sdk
  // (shared between the running opencode and openportal) still resolve when a
  // plugin spec happens to overlap.
  nodeModulesRoots.push(
    join(home, "projekty", "webapps", "portal", "apps", "web", "node_modules"),
  );

  // opencode caches each `<spec>` from `plugin: [...]` under its own
  // sub-directory of `~/.cache/opencode/packages`. The verbatim spec string
  // is the directory name (e.g. `oh-my-openagent@latest`).
  const packageCacheRoots: string[] = [
    join(home, ".cache", "opencode", "packages"),
  ];

  return { nodeModulesRoots, packageCacheRoots };
}

export function getCachedPluginInfo(spec: string): PluginInfo | null {
  const entry = cache.get(spec);
  return entry ? entry.info : null;
}

export function listCachedPluginSpecs(): string[] {
  return Array.from(cache.keys()).sort();
}

export function invalidatePluginInfo(spec: string): void {
  cache.delete(spec);
}

export async function refreshPluginInfo(
  port: number,
  spec: string,
): Promise<PluginInfo> {
  const existing = inflight.get(spec);
  if (existing) return existing;
  const p = (async () => {
    try {
      const roots = buildResolutionRoots(port);
      const info = await getPluginInfo(spec, nodePluginFs, roots);
      evictIfFull();
      cache.delete(spec); // re-insert at the tail so LRU order is correct
      cache.set(spec, { info, fetchedAt: Date.now() });
      return info;
    } finally {
      inflight.delete(spec);
    }
  })();
  inflight.set(spec, p);
  return p;
}

export async function getPluginInfoCached(
  port: number,
  spec: string,
): Promise<{ info: PluginInfo | null; refreshing: boolean }> {
  const entry = cache.get(spec);
  if (!entry) {
    void refreshPluginInfo(port, spec).catch(() => null);
    return { info: null, refreshing: true };
  }
  // Touch-on-read: re-insert at the tail so the LRU evict doesn't drop hot
  // entries.
  cache.delete(spec);
  cache.set(spec, entry);
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    void refreshPluginInfo(port, spec).catch(() => null);
    return { info: entry.info, refreshing: true };
  }
  return { info: entry.info, refreshing: false };
}

export async function prefetchAllPluginInfo(
  port: number,
  specs: string[],
): Promise<void> {
  if (prefetchedForPort.has(port)) return;
  prefetchedForPort.add(port);
  try {
    await Promise.all(
      specs.map((spec) => refreshPluginInfo(port, spec).catch(() => null)),
    );
  } catch {
    prefetchedForPort.delete(port);
  }
}

export async function prefetchAllPluginInfoFromConfig(
  port: number,
): Promise<void> {
  if (prefetchedForPort.has(port)) return;
  try {
    const opencode = getOpencodeClientV2(port);
    const cfg = await opencode.config.get();
    const raw = (cfg.data as { plugin?: unknown } | undefined)?.plugin;
    if (!Array.isArray(raw)) return;
    const specs = raw.filter((s): s is string => typeof s === "string");
    await prefetchAllPluginInfo(port, specs);
  } catch {
    // Best-effort - the modal will populate on first open if prefetch fails.
  }
}
