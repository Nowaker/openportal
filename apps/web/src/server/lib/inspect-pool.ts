// In-memory pool of opencode instances surfaced via the
// inspect-host flow. Lives separately from process-scan + mDNS
// discovery (which is re-run on every /api/servers poll); inspect
// results are kept here so they survive across polls AND so that
// the listing endpoint can fold them into the Discovered section
// alongside locally-detected entries.
//
// Each entry remembers the auth fingerprint we got from SSH (if
// any) so the frontend's Add button on a Discovered card can still
// persist credentials atomically when promoting an inspect-source
// entry. Credentials are never sent to the client; only the
// existence of a `password` is exposed via `hasPassword: true` so
// the UI can render the right copy.
//
// TTL: 15 minutes. The pool is meant as "the user just told us
// about these; don't forget them on the next poll" not "permanent
// record of every host they've ever inspected". After the TTL the
// entry drops out of Discovered and the user has to re-inspect if
// they still want it. Inspect's a cheap retry, so the short TTL is
// fine.

import type { BasicAuthCreds } from "./server-discovery";

export interface PooledFinding {
  host: string;
  port: number;
  // Stable id we hand back to the client so the Add-button flow
  // can re-look up auth at submit time. Synthesized from host:port.
  id: string;
  // Same shape the inspect-host endpoint returns to the client.
  label: string;
  source: "ssh" | "http-probe";
  needsAuth: boolean;
  // Live in memory only. The frontend gets `hasPassword: true` via
  // the listing endpoint; the actual password stays here until the
  // user clicks Add, at which point we read it and pass it to
  // addServer + auth-store.
  auth?: BasicAuthCreds;
  pid?: number;
  boundHost?: string;
  // Wall-clock time we added this. Drives TTL expiry.
  addedAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const pool = new Map<string, PooledFinding>();

function key(host: string, port: number): string {
  return `${host}:${port}`;
}

export function syntheticInspectId(host: string, port: number): string {
  return `inspect-${host.replace(/[^a-z0-9]/gi, "_")}-${port}`;
}

// Drop any entries older than TTL. Cheap; called inline from list
// operations.
function expireStale(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of pool) {
    if (v.addedAt < cutoff) pool.delete(k);
  }
}

export interface AddInspectFindingInput {
  host: string;
  port: number;
  label: string;
  source: "ssh" | "http-probe";
  needsAuth: boolean;
  auth?: BasicAuthCreds;
  pid?: number;
  boundHost?: string;
}

export function addInspectFinding(input: AddInspectFindingInput): PooledFinding {
  const id = syntheticInspectId(input.host, input.port);
  const entry: PooledFinding = {
    ...input,
    id,
    addedAt: Date.now(),
  };
  pool.set(key(input.host, input.port), entry);
  return entry;
}

export function listInspectFindings(): PooledFinding[] {
  expireStale();
  return [...pool.values()];
}

export function getInspectFindingById(id: string): PooledFinding | undefined {
  expireStale();
  for (const v of pool.values()) {
    if (v.id === id) return v;
  }
  return undefined;
}

// Drop entries for a host once they're promoted into Configured
// (or when the user removes them from Discovered explicitly).
export function dropInspectFinding(host: string, port: number): void {
  pool.delete(key(host, port));
}
