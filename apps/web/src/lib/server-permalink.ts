// Permalink plumbing for the `?server=<id>` parameter.
//
// OpenPortal is permalink-based: every URL names the opencode server it
// belongs to, so a link pasted into chat, scanned off a QR code, or
// opened on a phone lands on the same data as the tab it was copied
// from. When the receiving openportal cannot honour the named server -
// it has never heard of that id, or the server is configured but not
// answering - we must NOT silently fall back to whatever server happens
// to be active. That is exactly how a user ends up reading another
// machine's sessions while the URL claims otherwise.
//
// Instead we bounce to /servers carrying enough of the original URL to
// rebuild it: every search param and the hash ride along untouched, and
// the pathname travels in `from`. Clicking Open on a row then replays
// the original destination against the server the user actually picked.
// Nothing here loads or validates the destination - restoration is pure
// URL arithmetic, so it works for a session that has not been fetched,
// or does not exist yet on the server being opened.

export type ServerFallbackReason = "unknown" | "unreachable";

export const SERVER_FALLBACK_PARAM = "serverFallback";
export const SERVER_FROM_PARAM = "from";

export interface PermalinkLocation {
  pathname: string;
  search: Record<string, unknown>;
  // TanStack's ParsedLocation carries the hash WITHOUT a leading '#',
  // and navigate()/redirect() expect the same shape. Keep that
  // convention end to end so the value round-trips untouched.
  hash: string;
}

export interface NavigationTarget {
  to: string;
  search: Record<string, unknown>;
  hash: string;
}

// A `from` value only ever names a route inside this app. An absolute
// URL, a protocol-relative "//host" (which browsers read as a different
// origin), or the "/\" variant some parsers normalise to "//" would all
// turn the Open button into an open redirect. Reject rather than
// sanitise - a malformed permalink deserves the plain /servers page,
// not a guess at what its author meant.
export function isRestorablePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  return true;
}

// Where to send a permalink whose server cannot be used. The reason
// rides in the URL so /servers can say what happened even when the user
// reloads that page or shares it.
export function buildServerFallbackTarget(
  location: PermalinkLocation,
  reason: ServerFallbackReason,
): NavigationTarget {
  const search: Record<string, unknown> = { ...location.search };
  // Re-entrancy: bouncing twice must not stack `from` values. The
  // pathname we are leaving right now is the one worth remembering.
  search[SERVER_FROM_PARAM] = location.pathname;
  search[SERVER_FALLBACK_PARAM] = reason;
  return { to: "/servers", search, hash: location.hash };
}

// The inverse: rebuild the original destination, now pointed at
// `serverId`. Returns null when the current URL carries no restorable
// `from`, which is the ordinary case of someone visiting /servers
// directly - the caller then falls back to its normal post-open route.
export function buildRestoreTarget(
  location: PermalinkLocation,
  serverId: string,
): NavigationTarget | null {
  const from = location.search[SERVER_FROM_PARAM];
  if (!isRestorablePath(from)) return null;
  const search: Record<string, unknown> = { ...location.search };
  delete search[SERVER_FROM_PARAM];
  delete search[SERVER_FALLBACK_PARAM];
  // The destination belongs to the server the user just opened, not the
  // one the dead permalink named.
  search.server = serverId;
  return { to: from, search, hash: location.hash };
}
