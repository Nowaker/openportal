// Server registry. The "ground truth" list of opencode servers this Portal
// knows about, plus the currently active one. Persisted as additional fields
// in ~/.openportal.json so it lives next to the existing `directories[]`
// sidebar config.
//
// Three concepts:
//
//   - configured server: an entry the user has explicitly added (or that has
//     been promoted from a discovery). Survives across restarts.
//   - discovered server: detected at runtime (process scan, mDNS), shown in
//     the UI alongside configured servers. Not persisted; re-detected on
//     every list call.
//   - active server: the server the Portal UI is currently bound to.
//     Persisted in the registry. Drives `/api/instance/self`.
//
// A configured server can be marked `ephemeral: true`. That tells the
// resolver to refuse to fail when its stored port no longer answers — it
// should re-run discovery, update the stored port, and try again. This is
// how we attach to opencode-desktop, which picks a new ephemeral port on
// every relaunch.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { configFilePath } from "./portal-paths";

export type ServerKind = "manual" | "discovered-process" | "discovered-mdns";

export type DiscoveryHint = {
  // Used to re-find an ephemeral server after its port changes. For now we
  // only support opencode-desktop, which is matched by the spawned binary
  // path. Extend the union when we add more discovery sources.
  kind: "opencode-desktop";
};

// Per-server workspace directories override the top-level `directories`
// field when present. Same shape as the top-level: either a bare string
// path or a { path, level, level1 } object specifying how deep to walk
// from the base when grouping sessions by project. directoriesHistory
// keeps prior configurations as { at, directories } snapshots for the
// user to revert / re-apply from the UI (most recent first, capped at
// 10 entries).
export type ServerDirectoryEntry =
  | string
  | { path: string; level?: number; level1?: string[] };

export interface DirectoriesHistoryEntry {
  at: number;
  directories: ServerDirectoryEntry[];
}

export interface ConfiguredServer {
  id: string;
  label: string;
  host: string;
  port: number;
  ephemeral: boolean;
  discoveryHint?: DiscoveryHint;
  addedAt: string;
  directories?: ServerDirectoryEntry[];
  directoriesHistory?: DirectoriesHistoryEntry[];
}

// Normalize a raw history value from disk into the canonical
// `DirectoriesHistoryEntry[]` shape. Tolerates the legacy `string[]`
// format (each string is a JSON-stringified ServerDirectoryEntry[]
// with no timestamp - those entries get a synthetic `at: 0`). Silently
// drops anything that doesn't decode into a usable snapshot. Callers
// that READ directoriesHistory should run it through here exactly once,
// up at the boundary where the registry hands data out.
function normalizeHistory(raw: unknown): DirectoriesHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DirectoriesHistoryEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      try {
        const parsed = JSON.parse(item);
        if (Array.isArray(parsed)) {
          out.push({ at: 0, directories: parsed as ServerDirectoryEntry[] });
        }
      } catch {
        /* malformed legacy entry; drop */
      }
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as { at?: unknown; directories?: unknown };
      if (Array.isArray(obj.directories)) {
        const at = typeof obj.at === "number" ? obj.at : 0;
        out.push({
          at,
          directories: obj.directories as ServerDirectoryEntry[],
        });
      }
    }
  }
  return out;
}

export interface RawOpenPortalDoc {
  directories?: unknown;
  servers?: ConfiguredServer[];
  activeServerId?: string | null;
  // Any other top-level keys (decoupleOpencode, externalOpencode, etc.) are
  // preserved on write so we don't clobber CLI-only config.
  [key: string]: unknown;
}

// JSONC stripper. String-aware so `//` inside `"http://..."` is preserved.
// Mirror of the helper in portal-config.ts and packages/cli/src/index.ts.
// Three copies is bad; consolidating belongs in a follow-up cleanup.
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

function readRaw(): RawOpenPortalDoc {
  const path = configFilePath();
  if (!existsSync(path)) return {};
  try {
    const txt = stripJsoncComments(readFileSync(path, "utf-8"));
    if (!txt.trim()) return {};
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.warn(
      `[server-registry] Failed to read ${path}:`,
      e instanceof Error ? e.message : e,
    );
    return {};
  }
}

function writeRaw(doc: RawOpenPortalDoc): void {
  // Pretty-print so the file stays human-editable; users do hand-edit it.
  writeFileSync(configFilePath(), JSON.stringify(doc, null, 2) + "\n", "utf-8");
}

function isServer(s: unknown): s is ConfiguredServer {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    typeof o.host === "string" &&
    typeof o.port === "number" &&
    Number.isInteger(o.port) &&
    o.port > 0 &&
    o.port < 65536
  );
}

function generateServerId(): string {
  return "srv-" + Math.random().toString(36).slice(2, 10);
}

export function listConfiguredServers(): ConfiguredServer[] {
  const doc = readRaw();
  if (!Array.isArray(doc.servers)) return [];
  return doc.servers.filter(isServer).map((s) => {
    const rawHistory = (s as { directoriesHistory?: unknown })
      .directoriesHistory;
    return {
      ...s,
      ephemeral: Boolean(s.ephemeral),
      discoveryHint: s.discoveryHint,
      directoriesHistory:
        rawHistory === undefined ? undefined : normalizeHistory(rawHistory),
    };
  });
}

export function getActiveServerId(): string | null {
  const doc = readRaw();
  if (typeof doc.activeServerId === "string" && doc.activeServerId) {
    return doc.activeServerId;
  }
  return null;
}

export function getActiveServer(): ConfiguredServer | null {
  const id = getActiveServerId();
  if (!id) return null;
  return listConfiguredServers().find((s) => s.id === id) ?? null;
}

export function getServerById(id: string): ConfiguredServer | null {
  return listConfiguredServers().find((s) => s.id === id) ?? null;
}

export function getServerByPort(port: number): ConfiguredServer | null {
  return listConfiguredServers().find((s) => s.port === port) ?? null;
}

export interface AddServerInput {
  label: string;
  host: string;
  port: number;
  ephemeral?: boolean;
  discoveryHint?: DiscoveryHint;
}

export function addServer(input: AddServerInput): ConfiguredServer {
  const doc = readRaw();
  const servers = Array.isArray(doc.servers)
    ? doc.servers.filter(isServer)
    : [];

  // De-dup on host:port. If a manual entry already exists with the same
  // endpoint, return it instead of creating a phantom duplicate.
  const existing = servers.find(
    (s) => s.host === input.host && s.port === input.port,
  );
  if (existing) return existing;

  const entry: ConfiguredServer = {
    id: generateServerId(),
    label: input.label,
    host: input.host,
    port: input.port,
    ephemeral: Boolean(input.ephemeral),
    discoveryHint: input.discoveryHint,
    addedAt: new Date().toISOString(),
  };
  servers.push(entry);
  writeRaw({ ...doc, servers });
  return entry;
}

export function updateServer(
  id: string,
  patch: Partial<Omit<ConfiguredServer, "id" | "addedAt">>,
): ConfiguredServer | null {
  const doc = readRaw();
  const servers = Array.isArray(doc.servers)
    ? doc.servers.filter(isServer)
    : [];
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const merged: ConfiguredServer = {
    ...servers[idx],
    ...patch,
    id: servers[idx].id,
    addedAt: servers[idx].addedAt,
  };
  servers[idx] = merged;
  writeRaw({ ...doc, servers });
  return merged;
}

export function removeServer(id: string): boolean {
  const doc = readRaw();
  const servers = Array.isArray(doc.servers)
    ? doc.servers.filter(isServer)
    : [];
  const next = servers.filter((s) => s.id !== id);
  if (next.length === servers.length) return false;
  const update: RawOpenPortalDoc = { ...doc, servers: next };
  if (doc.activeServerId === id) update.activeServerId = null;
  writeRaw(update);
  return true;
}

export function setActiveServer(id: string | null): boolean {
  const doc = readRaw();
  if (id !== null) {
    const servers = Array.isArray(doc.servers)
      ? doc.servers.filter(isServer)
      : [];
    if (!servers.find((s) => s.id === id)) return false;
  }
  writeRaw({ ...doc, activeServerId: id });
  return true;
}

// Update only the live host/port on an ephemeral server. Used by the
// resolver after re-discovery shifts the live endpoint. No timestamp or
// label change so this stays cheap to run on every probe.
export function updateEphemeralEndpoint(
  id: string,
  host: string,
  port: number,
): ConfiguredServer | null {
  return updateServer(id, { host, port });
}

const HISTORY_MAX = 10;

export function setServerDirectories(
  id: string,
  directories: ServerDirectoryEntry[],
): ConfiguredServer | null {
  const doc = readRaw();
  const servers = Array.isArray(doc.servers)
    ? doc.servers.filter(isServer)
    : [];
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const prev = servers[idx];
  const prevDirs = prev.directories ?? [];
  const prevSerialized = JSON.stringify(prevDirs);
  const nextSerialized = JSON.stringify(directories);

  // Normalize whatever shape lives on disk (handles both the legacy
  // `string[]` format and the canonical `DirectoriesHistoryEntry[]`)
  // before we mutate it. This is also the migration point: legacy data
  // that has been touched once will be re-written in the new shape.
  const existingHistory = normalizeHistory(
    (prev as { directoriesHistory?: unknown }).directoriesHistory,
  );

  // De-dup: drop any historical entry that matches the value we're
  // about to commit, so a round-trip A -> B -> A leaves history with
  // just one A entry (the older one, kept for chronology).
  const filteredHistory = existingHistory.filter(
    (h) => JSON.stringify(h.directories) !== nextSerialized,
  );

  // Push the previous directories onto history, but only when it was
  // non-empty AND actually changing (avoids spurious "saved empty over
  // empty" snapshots).
  if (prevSerialized !== "[]" && prevSerialized !== nextSerialized) {
    filteredHistory.unshift({
      at: Date.now(),
      directories: prevDirs,
    });
  }

  const trimmedHistory = filteredHistory.slice(0, HISTORY_MAX);
  const merged: ConfiguredServer = {
    ...prev,
    directories,
    directoriesHistory: trimmedHistory,
  };
  servers[idx] = merged;
  writeRaw({ ...doc, servers });
  return merged;
}
