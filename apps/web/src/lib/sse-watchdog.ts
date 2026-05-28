// Wrap an EventSource with a heartbeat watchdog: if no data frame
// arrives within `silenceTimeoutMs`, close the underlying
// connection, reopen it, and fire an optional `onReconnect`
// callback so callers can refetch stale SWR data.
//
// Why this exists
// ---------------
// Browser EventSource auto-reconnects on TCP-level close. But a
// half-open socket - the one you get after a wifi handoff, after a
// deep-sleep wake, or after a transparent proxy half-closes
// midstream - leaves `readyState === OPEN` with no bytes arriving.
// The browser does NOT detect this. Application code must.
//
// Portal previously relied on `useConnectionMonitor` for catch-up:
// every 10s it probes `/api/instance/self` and, on a
// `down -> connected` transition, fires `mutate(() => true)`.
// That recovers from openportal restarts but NOT from a silently-
// dead SSE socket where `/api/instance/self` still answers
// happily. The user noticed this as "updates very flakey at
// times, I sometimes F5 to see if real progress happened."
//
// Why server heartbeats must be data frames (not SSE comments)
// ------------------------------------------------------------
// `EventSource.onmessage` only fires for `data:` lines. SSE
// comments (`: keepalive`) keep proxies from idle-closing but are
// invisible to the application. To make liveness observable in
// the browser, every Portal SSE handler now emits a data frame
// `data: {"type":"heartbeat","t":<ms>}\n\n` on its keepalive
// timer. Consumers' onmessage handlers update `lastEventAt` on
// every frame (including heartbeats) and ignore the heartbeat
// type in their downstream switch statements.
//
// Lifecycle
// ---------
// Construction kicks off the first connection synchronously. The
// returned handle exposes `close()` for explicit teardown
// (component unmount, app shutdown). A `setInterval` checks every
// `checkIntervalMs` (default 5s) whether `Date.now() -
// lastEventAt > silenceTimeoutMs`; on silence it closes the
// underlying EventSource, creates a new one, resets
// `lastEventAt`, and fires `onReconnect`. `close()` is
// idempotent; further reconnect cycles are skipped after close.
//
// The underlying EventSource handle is intentionally NOT exposed.
// Callers must not bypass the watchdog by holding a reference to
// the inner EventSource - it would be invalidated on every silent
// reconnect.

const DEFAULT_CHECK_INTERVAL_MS = 5_000;

export interface WatchdogOptions {
  /** URL to open the EventSource against. Reopened verbatim on reconnect. */
  url: string;
  /**
   * Maximum allowed silence between data frames before forcing a
   * reconnect. Should be at least 2x the server-side heartbeat
   * cadence; 60s is the standard choice for streams whose server
   * emits a heartbeat every 25-30s.
   */
  silenceTimeoutMs: number;
  /** Required: receives every `MessageEvent`, including heartbeats. */
  onMessage: (ev: MessageEvent) => void;
  /** Optional: fired on every native EventSource error. */
  onError?: (ev: Event) => void;
  /**
   * Optional: fired AFTER the watchdog has closed the dead
   * EventSource and opened a fresh one. Use this to invalidate
   * SWR caches scoped to whatever data the stream is supposed to
   * keep fresh.
   */
  onReconnect?: () => void;
  /**
   * How often the watchdog checks `lastEventAt` against
   * `silenceTimeoutMs`. Defaults to 5_000 (5s) - cheap, gives a
   * predictable upper-bound on detection latency.
   */
  checkIntervalMs?: number;
  /** Optional label for log lines; defaults to the URL. */
  label?: string;
}

export interface WatchedEventSource {
  /** Explicit teardown. Idempotent. Stops the watchdog timer and closes the underlying EventSource. */
  close(): void;
}

export function createWatchedEventSource(
  opts: WatchdogOptions,
): WatchedEventSource {
  if (typeof window === "undefined") {
    // SSR safety. Never opens a connection on the server; close()
    // is a no-op.
    return { close: () => {} };
  }

  const label = opts.label ?? opts.url;
  const checkIntervalMs = opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

  let es: EventSource | null = null;
  let lastEventAt = Date.now();
  let watchdog: number | null = null;
  let closed = false;

  function connect(): void {
    if (closed) return;
    const next = new EventSource(opts.url);
    next.onmessage = (ev) => {
      lastEventAt = Date.now();
      opts.onMessage(ev);
    };
    next.onerror = (ev) => {
      // Don't close here. The native EventSource state machine
      // will either auto-reconnect (CONNECTING) or stay in OPEN
      // with no events arriving. The watchdog covers both
      // cases.
      opts.onError?.(ev);
    };
    es = next;
  }

  function reconnect(): void {
    if (closed) return;
    console.log(
      `[sse-watchdog] ${label}: silence > ${opts.silenceTimeoutMs}ms; closing and reopening`,
    );
    if (es) {
      try {
        es.close();
      } catch {
        /* already closed */
      }
      es = null;
    }
    lastEventAt = Date.now();
    connect();
    try {
      opts.onReconnect?.();
    } catch (err) {
      console.warn(
        `[sse-watchdog] ${label}: onReconnect threw`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  function check(): void {
    if (closed) return;
    const idle = Date.now() - lastEventAt;
    if (idle > opts.silenceTimeoutMs) {
      reconnect();
    }
  }

  connect();
  watchdog = window.setInterval(check, checkIntervalMs);

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (watchdog !== null) {
        clearInterval(watchdog);
        watchdog = null;
      }
      if (es) {
        try {
          es.close();
        } catch {
          /* already closed */
        }
        es = null;
      }
    },
  };
}
