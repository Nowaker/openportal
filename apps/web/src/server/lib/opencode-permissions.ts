import { homedir } from "os";

import { getActiveServer } from "./server-registry";
import { fetchOpencode } from "./opencode-client";

// OpenPortal mirrors opencode's own file-read permission model instead of a
// fixed base-directory allowlist: it denies reading exactly what opencode
// would deny, and treats "ask" as allow (openportal is user-operated, so a
// prompt is unnecessary). The rules come from opencode's merged config via
// GET /config; we extract ONLY the `permission` subtree server-side and NEVER
// forward, cache, or log the rest of /config - it embeds provider API keys.

export type PermissionEffect = "allow" | "ask" | "deny";

export interface PermissionRule {
  resource: string;
  effect: PermissionEffect;
}

// The two permission categories that gate reads. `read` matches the file path
// (basename for absolute reads, project-relative for in-project reads);
// `external_directory` matches the absolute path of anything outside the
// project working directory. opencode's other categories (bash/edit/...) do
// not gate reads.
export interface ReadPermissionConfig {
  read: PermissionRule[];
  externalDirectory: PermissionRule[];
}

function isEffect(value: unknown): value is PermissionEffect {
  return value === "allow" || value === "ask" || value === "deny";
}

// Mirror opencode's config -> ruleset conversion (packages/core/src/v1/config/
// migrate.ts `permissions`): a bare effect string becomes a single "*" rule;
// an object becomes one rule per entry, preserving key order. Evaluation is
// last-match-wins, so the order is significant.
export function toRules(value: unknown): PermissionRule[] {
  if (isEffect(value)) return [{ resource: "*", effect: value }];
  if (value && typeof value === "object") {
    const out: PermissionRule[] = [];
    for (const [resource, effect] of Object.entries(value as Record<string, unknown>)) {
      if (isEffect(effect)) out.push({ resource, effect });
    }
    return out;
  }
  return [];
}

// Byte-for-byte port of opencode's wildcard matcher (packages/core/src/util/
// wildcard.ts): `*` -> any run of chars (including `/`), `?` -> one char,
// everything else literal, anchored, dotall. Case-insensitive only on Windows,
// matching upstream.
export function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replace(/\\/g, "/");
  let escaped = pattern
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?";
  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(
    normalized,
  );
}

// opencode's evaluate(): the last matching rule wins; fall back to the tool's
// default effect when nothing matches.
export function evaluateEffect(
  resource: string,
  rules: PermissionRule[],
  fallback: PermissionEffect,
): PermissionEffect {
  for (let i = rules.length - 1; i >= 0; i--) {
    if (wildcardMatch(resource, rules[i].resource)) return rules[i].effect;
  }
  return fallback;
}

// `external_directory` patterns are written relative to home (`~/...`,
// `$HOME/...`); opencode expands them before matching. We expand against the
// openportal host's home because that is the filesystem these patterns are
// applied to here.
export function expandHomePattern(pattern: string): string {
  const home = homedir();
  if (pattern === "~" || pattern === "$HOME") return home;
  if (pattern.startsWith("~/")) return home + pattern.slice(1);
  if (pattern.startsWith("$HOME/")) return home + pattern.slice(5);
  return pattern;
}

interface CacheEntry {
  value: ReadPermissionConfig | null;
  ts: number;
}

// Short TTL: opencode runs on the same host/tailnet, so re-fetching is cheap,
// and a newly-added deny rule should take effect within a couple of seconds.
const CACHE_TTL_MS = 2000;
const cache = new Map<string, CacheEntry>();

export function clearReadPermissionCache(): void {
  cache.clear();
}

// Fetch the active opencode server's merged permission config for `directory`
// (project-local .opencode config merges in when a directory is passed).
// Returns null on ANY failure (no active server, unreachable opencode, non-OK
// response, parse error) so callers can fail CLOSED. Only the `read` and
// `external_directory` subtrees are retained; the raw /config (with provider
// API keys) is never stored, returned, or logged.
export async function fetchReadPermissionConfig(
  directory?: string,
): Promise<ReadPermissionConfig | null> {
  const key = directory ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const value = await load(directory);
  cache.set(key, { value, ts: Date.now() });
  return value;
}

async function load(directory?: string): Promise<ReadPermissionConfig | null> {
  const port = getActiveServer()?.port;
  if (!port) return null;

  const path = "/config" + (directory ? `?directory=${encodeURIComponent(directory)}` : "");
  // fetchOpencode never throws (returns a synthetic 502 on transport failure),
  // but guard anyway so an unexpected throw still fails closed rather than 500.
  let res: Response;
  try {
    res = await fetchOpencode(port, path);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let permission: unknown;
  try {
    const body = (await res.json()) as { permission?: unknown } | null;
    permission = body?.permission;
  } catch {
    return null;
  }

  const perm =
    permission && typeof permission === "object"
      ? (permission as Record<string, unknown>)
      : {};
  return {
    read: toRules(perm.read),
    externalDirectory: toRules(perm.external_directory).map((rule) => ({
      ...rule,
      resource: expandHomePattern(rule.resource),
    })),
  };
}
