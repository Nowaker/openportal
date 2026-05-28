// Shared SSE heartbeat helper for every Portal-owned SSE endpoint.
//
// Why heartbeats are DATA FRAMES (not SSE comments)
// -------------------------------------------------
// Portal SSE handlers previously emitted `: keepalive\n\n` /
// `: ping\n\n` (SSE comments) to keep idle connections from being
// closed by intermediate proxies (Caddy idle-close defaults to
// 60s). That kept the wire alive but was invisible to the
// browser's EventSource: comments do not fire `onmessage`. A
// silently-dead socket - the one you get after wifi handoff,
// deep-sleep wake, or a proxy half-close - leaves
// `EventSource.readyState === OPEN` with no bytes arriving and
// no detection signal anywhere in JS.
//
// Now every handler emits this data frame instead:
//
//   data: {"type":"heartbeat","t":<unix-ms>}\n\n
//
// EventSource consumers see this as a normal `MessageEvent` and
// can track `lastEventAt` to detect silence. Consumer switch
// statements treat the type as ignorable noise (default branch).
// The frame's `t` field varies on every emission so the byte
// stream changes - useful for DevTools network panel debugging
// and as defense against any caching gremlin that would dedup
// identical frames.

const encoder = new TextEncoder();

export function heartbeatFrame(): Uint8Array {
  return encoder.encode(`data: {"type":"heartbeat","t":${Date.now()}}\n\n`);
}

/** Standard heartbeat cadence for Portal SSE handlers. 25s is well below
 * Caddy's 60s idle-close default and well below the 60s client-side
 * watchdog silence threshold, leaving room for one missed heartbeat
 * before the watchdog kicks in. */
export const HEARTBEAT_INTERVAL_MS = 25_000;
