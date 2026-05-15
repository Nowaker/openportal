// In-memory tracker for "is the user physically at the computer running
// openportal right now?" Every browser-classified HTTP request updates a
// single record (ip + isLocal verdict from detectClient + timestamp);
// every subsequent caller reads that record. Last request wins, no time
// window, no decay - if the most recent browser ping came from a remote
// tailnet peer, the user is treated as remote, regardless of what
// requests happened before.
//
// Why a single record and not a mini-history: the spec is "last request
// wins". A new entry from any browser overwrites the previous one, so
// there is no stale-entry-beats-fresh-entry problem to defend against.
// The simplest data structure already enforces the invariant.
//
// Why in-memory and not persisted: openportal lifecycle == openportal
// process lifecycle. A restart legitimately resets presence - the
// browser will reissue a request the moment the connection-monitor
// reconnects, and the tracker is repopulated within milliseconds.
// Persisting to disk would re-introduce the stale-after-reboot bug
// this design is trying to avoid.
//
// Why browser-only: the AI dispatches sudo via the openportal-sudo-mcp
// sidecar, which calls /api/sudo/run from a non-browser HTTP client
// running on this host. If we counted every request, that sidecar call
// would itself flip presence to "local" right before the dispatcher
// checks it. We explicitly exclude non-browser User-Agents so the
// tracker reflects where the user's eyes actually are, not where
// internal tooling happens to fire from.

import type { ClientInfo } from "./client-detection";

interface PresenceRecord {
  ip: string;
  isLocal: boolean;
  at: number;
  userAgent: string | null;
}

let latest: PresenceRecord | null = null;

// Heuristic: a "real browser" puts Mozilla, Chrome, Safari, Firefox,
// or Edge somewhere in its User-Agent. curl, wget, Bun/Node fetch,
// the openportal-sudo-mcp sidecar, and most other automated callers
// do not. A malicious caller could forge a browser UA, but the threat
// model is the user fooling themselves - tailnet ACL already gates
// who can reach openportal at all.
const BROWSER_UA_RE = /Mozilla|Chrome|Safari|Firefox|Edge/i;

export function isBrowserUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BROWSER_UA_RE.test(ua);
}

export function recordBrowserPresence(
  client: ClientInfo,
  userAgent: string | null,
): void {
  if (!isBrowserUserAgent(userAgent)) return;
  latest = {
    ip: client.ip,
    isLocal: client.isLocal,
    at: Date.now(),
    userAgent,
  };
}

export interface BrowserPresence {
  ip: string;
  isLocal: boolean;
  at: number;
}

export function getLatestBrowserPresence(): BrowserPresence | null {
  if (!latest) return null;
  return { ip: latest.ip, isLocal: latest.isLocal, at: latest.at };
}

// "Is the user physically at the computer running openportal right
// now?" - true iff the most recent browser request came from one of
// this host's IPs. staleMs is an optional sanity cap: if the last
// browser request is older than staleMs ms, return false even if it
// was local. Default: no cap (last request wins forever, matching
// the spec). Callers like the sudo dispatcher do NOT pass staleMs -
// they want strict "last request wins" semantics.
export function isUserLocallyPresent(staleMs?: number): boolean {
  if (!latest) return false;
  if (staleMs !== undefined && Date.now() - latest.at > staleMs) return false;
  return latest.isLocal;
}

export function _resetPresenceTrackerForTests(): void {
  latest = null;
}
