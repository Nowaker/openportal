# SSE Reconnection Behavior

Investigation into what happens to the frontend when openportal restarts
(the "OpenPortal updated - reload to upgrade" banner case) or when
opencode is unavailable, and whether events emitted during the gap are
recoverable. Also addresses observed UI flakiness where F5 is the user's
workaround.

## Implementation update (2026-05-27, branch `sse-watchdog`)

The "F5 reflex" failure mode this doc surfaced has been closed by a
client-side heartbeat watchdog. The relevant code:

- [`apps/web/src/lib/sse-watchdog.ts`](../apps/web/src/lib/sse-watchdog.ts):
  new helper `createWatchedEventSource()` that wraps `new
  EventSource(url)` with a silence-timeout check (default 60s). If no
  `onmessage` fires within `silenceTimeoutMs`, the wrapper closes the
  underlying socket, opens a fresh one, and fires an optional
  `onReconnect` callback for scoped SWR refetch.
- [`apps/web/src/server/lib/sse-heartbeat.ts`](../apps/web/src/server/lib/sse-heartbeat.ts):
  shared server-side helper. Every Portal-owned SSE handler now emits
  `data: {"type":"heartbeat","t":<ms>}\n\n` every 25s instead of the
  old `: keepalive\n\n` / `: ping\n\n` SSE comments. Comments don't
  fire `onmessage`; data frames do, which is what the watchdog needs
  to observe liveness.
- Server endpoints updated to the data-frame heartbeat:
  [`indicators/stream.get.ts`](../apps/web/src/server/indicators/stream.get.ts),
  [`session-ops/[runId]/stream.get.ts`](../apps/web/src/server/session-ops/%5BrunId%5D/stream.get.ts),
  [`stuck-detector/events/stream.get.ts`](../apps/web/src/server/stuck-detector/events/stream.get.ts),
  and [`opencode/[port]/event.ts`](../apps/web/src/server/opencode/%5Bport%5D/event.ts)
  (the upstream-pass-through proxy now injects its own Portal-level
  heartbeats in addition to forwarding opencode's `server.heartbeat`
  events).
- Client hooks wired through the watchdog:
  [`use-indicators.ts`](../apps/web/src/hooks/use-indicators.ts),
  [`use-event-stream.ts`](../apps/web/src/hooks/use-event-stream.ts)
  (also fires a scoped `mutate(key => key.startsWith("/api/opencode/<port>/"))`
  on reconnect so any SWR data for the port refetches),
  [`use-stuck-detector-events.ts`](../apps/web/src/hooks/use-stuck-detector-events.ts).
- `LongOpDialog` was intentionally NOT wrapped: the dialog is
  short-lived per-user-action; the watchdog is only valuable for
  long-running app-wide streams.

Verification on the `sse-watchdog` worktree (port 5201):

- `curl -N /api/indicators/stream` showed the snapshot frame followed
  by `data: {"type":"heartbeat","t":1779944487932}` at +25s.
- `curl -N /api/stuck-detector/events/stream` showed two
  `data: {"type":"heartbeat","t":...}` frames in a 30s window.
- `curl -N /api/opencode/4096/event` showed opencode's own
  `server.heartbeat` events at ~3s intervals (a pleasant surprise -
  the upstream is less starved than this doc originally assumed) PLUS
  the Portal proxy's injected `data: {"type":"heartbeat","t":...}` at
  +25s. The latter is the belt-and-suspenders signal that the Portal
  hop itself is alive, independent of upstream.
- Chrome DevTools session on the worktree: all 3 SSE connections
  established, zero JS errors in the console, page rendered.

The original "Recommended follow-ups" section below remains as
historical context. Items 1 and the necessary server-side changes are
DONE. Items 2 and 3 (sequence-number replay, persistent event log)
remain open and are still appropriate to defer - state convergence
plus per-stream watchdog is sufficient for current UX needs.

## Follow-up enhancements shipped same session

Three small post-watchdog landings closed the residual loops:

- **AGENTS.md probe-timeout drift fix (`3a049de`)**: the "Connection
  resilience" section had said `useConnectionMonitor` uses a 5s
  probe timeout, but the actual code at [`use-connection-monitor.ts:7`](../apps/web/src/hooks/use-connection-monitor.ts#L7)
  is `PROBE_TIMEOUT_MS = 15_000`. Doc now matches code, plus the
  failure-threshold detail (2 consecutive fails) and the
  fast-probe-while-down cadence (2s interval) — both verbatim from
  the code.
- **SSR-safety + idempotent-close unit tests for the watchdog
  (`a52e777`)**: file at [`apps/web/src/lib/sse-watchdog.test.ts`](../apps/web/src/lib/sse-watchdog.test.ts).
  Two tests using the codebase's existing `bun:test` framework:
  (1) `createWatchedEventSource` returns a no-op handle when
  `typeof window === "undefined"` (no real EventSource ever
  opens); (2) repeated `handle.close()` calls never throw. Full
  timer-mock testing of the reconnect path was deferred — mock
  infrastructure cost outweighed the value given that the wire-
  level (curl) + Chrome DevTools browser verification already cover
  the live path.
- **Drawer logging for watchdog reconnects (`a10273b`)**: all three
  long-lived consumers
  ([`use-event-stream.ts`](../apps/web/src/hooks/use-event-stream.ts),
  [`use-indicators.ts`](../apps/web/src/hooks/use-indicators.ts),
  [`use-stuck-detector-events.ts`](../apps/web/src/hooks/use-stuck-detector-events.ts))
  now pass an `onReconnect` callback that fires
  `logSystemMessage("connection", "warning", ...)` so silently-
  dead-socket recoveries land in the system-messages drawer. The
  original F5-symptom trigger ("updates very flakey at times, I
  sometimes F5") is now self-diagnosing: the user sees a drawer
  entry the moment the watchdog reopens a stuck stream.

## Testing limitation found while verifying

Chrome DevTools' `emulate({networkConditions: "Offline"})` does
**not** sever existing TCP sockets — it only blocks NEW outbound
connections. The existing SSE TCP streams stayed alive during the
test, kept receiving heartbeat frames from the server, and `lastEventAt`
kept advancing. Result: the watchdog correctly stayed quiet (no
silently-dead socket to detect), but the test setup couldn't
reproduce the failure mode the watchdog is designed for. Real-world
triggers (wifi handoff, deep-sleep wake, transparent proxy
half-close) DO sever the socket from the kernel's perspective in a
way that leaves `readyState === OPEN` while bytes stop arriving;
those are the silent-failure scenarios the watchdog catches.
Verification of the live path will happen organically the next
time the user encounters that pattern — a `[sse-watchdog] …:
silence > 60000ms; closing and reopening` console line plus a
"Indicator stream reconnected" drawer entry will confirm.

---

## Original investigation (pre-implementation)

## TL;DR

**Events emitted between disconnect and reconnect are PERMANENTLY LOST
on the SSE channel.** There is no `Last-Event-ID`, no sequence numbers,
no replay buffer. The codebase compensates with two convergence
mechanisms instead:

1. **Snapshot on reconnect** — `/api/indicators/stream` sends a fresh
   `snapshot` frame on every new connection with the current full
   state, scoped to the consumer's filter.
2. **Global SWR refetch on reconnect** — when `useConnectionMonitor`
   detects a transition `down -> connected`, it fires
   `mutate(() => true)`, invalidating every SWR key in the app.

So the user always sees the **final/current state** correctly. What
they MISS is the intermediate trajectory — token-by-token streaming
deltas, transient busy badges, ephemeral progress dots — those frames
are gone forever.

The "F5 to see real progress" pattern is symptomatic of the third gap
(see [Why F5 Works](#why-f5-still-helps-and-the-perceived-flakiness)):
when the SSE socket silently died but `/api/instance/self` still says
"connected", the monitor never transitions and never fires the global
refetch, so the user is stuck with stale SWR data until they reload.

---

## 1. SSE Streams in OpenPortal

Three independent EventSource connections per browser tab:

| Endpoint | Server handler | Client hook | Purpose |
|---|---|---|---|
| `/api/indicators/stream` | [`server/indicators/stream.get.ts`](../apps/web/src/server/indicators/stream.get.ts) | [`hooks/use-indicators.ts`](../apps/web/src/hooks/use-indicators.ts) | Indicator state: busy/idle, questions, permissions, todos, stuck verdict, pending prompts |
| `/api/opencode/<port>/event` | [`server/opencode/[port]/event.ts`](../apps/web/src/server/opencode/%5Bport%5D/event.ts) | [`hooks/use-event-stream.ts`](../apps/web/src/hooks/use-event-stream.ts) | Pass-through proxy of opencode's `/event` SSE stream (message deltas, session lifecycle) |
| `/api/stuck-detector/events/stream` | [`server/stuck-detector/events/stream.get.ts`](../apps/web/src/server/stuck-detector/events/stream.get.ts) | [`hooks/use-stuck-detector-events.ts`](../apps/web/src/hooks/use-stuck-detector-events.ts) | Stuck-detector verdicts and recovery journal |

All three use the same wire format and share the same resilience
properties (or lack thereof).

### Wire format: no sequence numbers, no event IDs

`server/indicators/stream.get.ts:42-50`:

```ts
const send = (payload: SubscriberPayload) => {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
  );
};
```

Only `data:` lines. No `id:`, no `event:`, no `retry:`. The SSE spec
allows `id:` to enable `Last-Event-ID` header replay on reconnect —
this codebase does not use it.

### Heartbeats keep proxies from idle-closing

- Indicators: `: keepalive` comment every **25s** (`stream.get.ts:25,59-65`)
- Stuck-detector: `: ping` comment every 30s
- Opencode event proxy: no Portal-side heartbeat (relies on upstream
  opencode's heartbeat passing through)

These are below Caddy's 60s idle-close default, so a healthy connection
stays alive.

---

## 2. Server-side state: in-memory only

The indicator state lives entirely in process memory:

`server/lib/indicator-state.ts` (key data structures):

```ts
const sessions = new Map<string, SessionIndicatorState>();
const subs = new Set<Subscription>();
```

- Map keyed by `${serverId}::${sessionId}`.
- `subs` is the fan-out set of connected browser SSE subscriptions.
- **No persistent event log. No queue. No durable history.**

The stuck-detector stream uses an `EventEmitter` — same volatility.

The opencode `/event` proxy holds no state at all; bytes flow through
verbatim from upstream opencode.

### Snapshot on connect

`server/indicators/stream.get.ts:52-55`:

```ts
send({
  type: "snapshot",
  sessions: getSnapshot({ serverId, sessionId }),
});
```

Every new connection — including every reconnect after a drop — gets
a fresh full snapshot before any deltas. This is the **only** mechanism
that closes the gap caused by missed events on the indicator stream.

The opencode event stream has **no equivalent**. It's a verbatim
pass-through, so on reconnect it starts fresh and the client gets only
NEW events from that point forward.

---

## 3. Indicator-broadcaster: server-side reconnect to upstream

`server/plugins/indicator-broadcaster.ts:196-265` runs one upstream
fetch per configured opencode server. On disconnect:

```ts
const delay = Math.min(
  RECONNECT_BASE_DELAY_MS * 2 ** Math.min(retry, 5),
  RECONNECT_MAX_DELAY_MS,
);
```

Exponential backoff capped at 30s (1s -> 2s -> 4s -> 8s -> 16s -> 30s).

On successful reconnect, it **does NOT replay missed events**. Instead
it calls `hydrateFromStatusEndpoint` (`indicator-broadcaster.ts:154-194`)
which fetches `/session/status` from opencode and emits synthetic
`session.status` events for every session. It also rehydrates pending
prompts from SQLite via `rehydratePendingPromptsForSession`.

So the broadcaster's "catch up" is **state convergence via REST + SQL**,
not event-stream replay.

---

## 4. Client-side reconnect: native EventSource only

All three client hooks use native `EventSource` with no explicit
reconnect logic:

`hooks/use-indicators.ts:119-130`:

```ts
const es = new EventSource("/api/indicators/stream");
es.onmessage = (ev) => { apply(JSON.parse(ev.data)); };
es.onerror = () => {
  // EventSource auto-reconnects with backoff. No-op here.
};
```

`hooks/use-event-stream.ts:56-68`: same pattern, same comment.

The browser's native `EventSource` semantics:

- Auto-reconnects with exponential backoff (UA-specific, typically
  starts at 1-3s and grows).
- Sends `Last-Event-ID` header IF the server had previously emitted
  `id:` fields — **but Portal never emits them**, so the header is
  always empty on reconnect.
- Has no API to force a snapshot fetch on reconnect.

**Net result:** EventSource reconnects silently in the background. The
indicators stream receives a fresh snapshot (gap closes for indicator
data). The opencode event stream receives only NEW events (gap stays
open for any deltas that fired during the dead window).

---

## 5. Global SWR refetch as the real catch-up mechanism

`hooks/use-connection-monitor.ts:55-243` is the second convergence
layer. It probes `/api/instance/self` on a schedule:

```ts
const PROBE_INTERVAL_MS = 10_000;             // healthy interval
const PROBE_INTERVAL_WHILE_DOWN_MS = 2_000;   // faster while down
const PROBE_TIMEOUT_MS = 15_000;              // per-probe timeout
const FAILURE_THRESHOLD = 2;                  // consecutive fails before flipping banner
```

Three states:

- `connected` — steady state.
- `opencode-down` — Portal up, its bound opencode reports `health=down`.
  Yellow banner. Portal-owned data (prompts archive, settings, server
  list) still renders.
- `openportal-down` — `/api/instance/self` itself failed past the
  threshold. Red banner. Nothing live can load.

Also triggers a probe on `focus`, `visibilitychange`, and `online`
events (lines 216-227).

**The gap-fill happens on transition `down -> connected`**
(`use-connection-monitor.ts:193-198`):

```ts
if (next === "connected" && prev !== "connected") {
  console.log("[connection-monitor] firing global SWR mutate(() => true) to refetch all keys");
  void mutate(() => true);
}
```

This invalidates **every SWR cache key** in the app. The next render
of every component that uses SWR triggers a fresh fetch. This is the
true mechanism by which the UI catches up after openportal restart:
the SSE channel itself replays nothing, but every REST-backed view
refetches and returns the converged state.

---

## 6. The "OpenPortal updated - reload to upgrade" banner

Polling-based, not event-driven.

### Build ID

Stamped into the bundle at build time via Vite:

```ts
const BUILD_ID = String(Date.now());
define: { __OPENPORTAL_BUILD_ID__: JSON.stringify(BUILD_ID) }
```

And sent as a response header by `server/plugins/build-id-header.ts`:

```ts
hooks.hook("response", (event) => {
  event.headers.set("X-OpenPortal-Build", __OPENPORTAL_BUILD_ID__);
});
```

### Detection

`hooks/use-build-mismatch.ts:21-58`:

```ts
const POLL_URL = "/api/instance/self";
const POLL_INTERVAL_MS = 60_000;
// ...
if (theirs && theirs !== ours) {
  setMismatched(true);
  // log to system-messages drawer
}
```

- Polls `/api/instance/self` every **60s** with `cache: "no-store"`.
- Also fires on `focus`.
- Compares response header against bundled constant.
- One-way trapdoor — never resets once tripped.
- **Does NOT auto-reload**. User must Ctrl+R manually.

### What happens during a Portal restart cycle

`scripts/deploy.sh` flow (per repo AGENTS.md):

1. Build new bundle (with new `BUILD_ID`).
2. Restart `openportal-dev.service` first (probes for 15s).
3. ONLY if dev came up green, restart `openportal.service` (prod).

When prod restarts:

- All three browser EventSource connections drop.
- The connection-monitor's next probe fails. After 2 consecutive
  failures (~20s worst case), the banner flips to `openportal-down`.
- Browser EventSource starts its native reconnect loop (1-3s base).
- Once Portal is back, the next monitor probe transitions to
  `connected`, fires `mutate(() => true)`.
- Roughly in parallel, EventSource reconnects, indicators stream sends
  fresh snapshot.
- The next build-mismatch poll (within 60s) detects the new
  `X-OpenPortal-Build` header and shows the "reload to upgrade" banner.

The asset-fallback layer (see AGENTS.md) keeps the stale bundle alive
during this — old asset hashes are still served — so the page doesn't
crash. But the JS code in the page is the OLD bundle; the user must
reload to pick up new behavior. That's what the banner asks for.

---

## 7. The "opencode not available" banner

Triggered by `useConnectionMonitor` (above) when:

```ts
const opencodeHealth = body?.health?.opencode;
if (opencodeHealth === "down") {
  if (body?.lastKnown) {
    probed = "opencode-down";
  } else {
    probed = "connected";  // no lastKnown → treat as transient
  }
}
```

Two failure modes:

- `health.opencode = "down"` + `lastKnown` present → yellow banner.
  Portal-owned data still renders (prompts, settings, sessions list
  from local cache).
- `health.opencode = "down"` + no `lastKnown` → treated as transient,
  stays in `connected` state.

The `/api/instance/self` endpoint computes `health.opencode` by
probing the bound opencode server. The exact criteria for `up` vs
`down` live in `server/api/instance/self.ts` (not read in this
investigation; see `panel-context_search_code` if needed).

---

## 8. The user's specific scenario: seq=5 -> seq=10 over a gap

**Question:** "If last seen was sequence number 5, and during the gap
sequence numbers 6-10 happened, will the frontend receive them?"

**Answer:** Mechanically, no. Sequence numbers don't exist in this
codebase, and the SSE wire format has no replay capability. Events
6-10 are not transmitted on reconnect.

**But what the user actually sees** depends on which stream those
events belonged to:

### Indicator events (busy/idle, questions, permissions, todos)

- The `snapshot` frame on reconnect carries the **current** indicator
  state, which reflects the cumulative effect of events 6-10.
- If event 6 said "started typing", event 7 said "added todo", event
  10 said "stopped typing": the snapshot shows "stopped typing + todo
  exists". The user sees the right final state.
- What's lost: the **trajectory**. If a question briefly appeared and
  was answered during the gap, the user never saw it pop up.

### Opencode message events (token-by-token streaming)

- The proxy is verbatim pass-through — no snapshot is sent on
  reconnect. Events 6-10 (which would have been `message.part.delta`
  frames) are **gone**.
- HOWEVER: the connection-monitor's `mutate(() => true)` on reconnect
  refetches `/messages` for the open session. `/messages` returns the
  current converged assistant text — including the content of all
  missed deltas.
- What's lost: the **streaming animation**. The user sees the full
  text appear at once instead of token-by-token.

### Session lifecycle events (created, updated, deleted)

- Missed events are lost on the wire.
- Sessions list refetches on `session.*` events via SWR mutate
  (`use-event-stream.ts:124-130`).
- The global mutate on reconnect refetches the sessions list too.
- Net: session list converges to current state.

---

## 9. Why F5 still helps, and the perceived flakiness

The user observed: "updates are flakey at times, I sometimes F5 to see
if real progress happened."

This is not paranoia. There are genuine cases where the UI gets stuck
on stale data despite the convergence mechanisms above:

### Failure mode 1: EventSource silently dead, monitor still happy

The browser's `EventSource.readyState` can be `OPEN` (1) but no events
actually arrive — e.g. after a wifi network handoff, after a deep sleep
wake, or with certain proxy misbehaviors. In this scenario:

- `useConnectionMonitor` is still happily probing `/api/instance/self`
  every 10s and getting `connected` responses.
- No state transition fires, so no `mutate(() => true)` runs.
- The dead EventSource never delivers events for new opencode activity.
- SWR keys for `/messages` etc. sit on stale data (no refresh interval
  is configured for those).
- The user sees frozen UI.
- F5 = full reload = fresh EventSource + fresh SWR cache + correct state.

**There is no detector for this case in the current codebase.** A
heartbeat-timeout watchdog on each EventSource (no events for N seconds
-> close and reopen, OR force a global mutate) would close this gap.

### Failure mode 2: Race during reconnect

EventSource reconnects, but the indicator snapshot arrives before
backend `hydrateFromStatusEndpoint` finishes its `/session/status`
fetch. The snapshot is built from `indicator-state.ts` which is still
mid-rehydration. Some sessions may be missing or marked as `connected:
false` for a beat.

This is racy but generally self-heals within seconds as hydration
catches up and emits `session.status` events that update the indicator
map and fan out to subscribers.

### Failure mode 3: Token deltas lost, /messages cache stale

The opencode event proxy invalidates the per-session messages cache on
delta events (`server/opencode/[port]/event.ts:68-74`). But the cache
has a 2s TTL by default. If the SSE socket dies AFTER the cache was
freshly populated but BEFORE the next delta would have invalidated it,
and the connection-monitor doesn't transition (failure mode 1), then
the next `/messages` fetch (e.g. on tab focus) returns the stale cache.

### Workarounds the user already has

- F5 — full reload, fixes everything.
- Tab focus — fires `useConnectionMonitor` probe and `useBuildMismatch`
  probe immediately. If those detect anything, recovery flows trigger.
  But if both are healthy (failure mode 1), focus alone doesn't help.
- Tab visibility change (e.g. switching tabs back) — same as focus.

### What would actually fix it

Three options, increasing in cost:

1. **Per-stream heartbeat watchdog on the client.** Track time since
   last event/keepalive per EventSource. If silence exceeds (say) 2x
   the server's heartbeat interval, close and reopen the EventSource
   AND fire `mutate(() => true)`. Cheap, ~50 lines.
2. **Sequence numbers + Last-Event-ID replay** on the indicator stream.
   Buffer last N events server-side keyed by sequence. On reconnect,
   honor the `Last-Event-ID` header and replay since. Medium cost;
   server holds a ring buffer per subscription scope.
3. **Persistent event log** in SQLite. True audit trail, replayable
   across server restarts. Highest cost; not justified for current UX
   requirements but the right answer if openportal ever needs an audit
   log or message-delivery guarantees.

Option 1 alone would address the user's reported flakiness in most
real-world cases. It would not recover events lost during an actual
Portal restart (server is gone, has nothing to send), but it would
catch silently-dead sockets and force a refetch.

---

## 10. Summary table

| Question | Answer | Evidence |
|---|---|---|
| Are SSE events buffered on the server? | No | `indicator-state.ts:89` — in-memory Map, no log |
| Do SSE frames carry sequence numbers? | No | `stream.get.ts:45` — only `data:` line |
| Does the client send `Last-Event-ID`? | No (effectively) | Native EventSource sends it only if server emitted `id:`, which Portal never does |
| Are missed events replayable after reconnect? | No | No mechanism exists |
| What survives a Portal restart on disk? | Prompts archive (SQLite) | `~/.local/share/openportal/openportal.db` |
| How does indicator state recover? | Fresh snapshot on every reconnect + backend rehydrates from `/session/status` | `stream.get.ts:52-55`, `indicator-broadcaster.ts:154-194` |
| How does message data recover? | `useConnectionMonitor` fires global `mutate(() => true)` on reconnect; `/messages` refetches | `use-connection-monitor.ts:193-198` |
| What detects "OpenPortal updated"? | 60s poll of `X-OpenPortal-Build` header | `use-build-mismatch.ts:8,29-46` |
| What detects "OpenCode unavailable"? | 10s probe of `/api/instance/self` reading `health.opencode` field | `use-connection-monitor.ts:5,86-104` |
| Why does F5 sometimes fix things when the banner is happy? | EventSource can be silently dead while `/api/instance/self` still reports connected; no watchdog detects this. F5 is the only recovery. | No code — this is the missing piece |

---

## 11. Recommended follow-ups

Listed in priority order. None are required to answer the user's
original question — these are next-step engineering items.

1. **Add a per-stream heartbeat watchdog** in
   `hooks/use-indicators.ts` and `hooks/use-event-stream.ts`. Track
   last-event-received timestamp; if it exceeds 60s (2x the indicators
   heartbeat) without any event or keepalive, force-close and reopen.
   On reopen, also fire `mutate(() => true)` since data may be stale.
2. **Document the "F5 fixes it" failure mode** in AGENTS.md so future
   sessions know to look at the watchdog as a fix.
3. **(Optional)** Add sequence numbers + `Last-Event-ID` replay on
   `/api/indicators/stream`. Lower-priority — the snapshot mechanism
   already converges state, and message intermediate states aren't
   audit-critical.

---

## References

- [`apps/web/src/server/indicators/stream.get.ts`](../apps/web/src/server/indicators/stream.get.ts)
- [`apps/web/src/server/lib/indicator-state.ts`](../apps/web/src/server/lib/indicator-state.ts)
- [`apps/web/src/server/plugins/indicator-broadcaster.ts`](../apps/web/src/server/plugins/indicator-broadcaster.ts)
- [`apps/web/src/server/opencode/[port]/event.ts`](../apps/web/src/server/opencode/%5Bport%5D/event.ts)
- [`apps/web/src/server/plugins/build-id-header.ts`](../apps/web/src/server/plugins/build-id-header.ts)
- [`apps/web/src/hooks/use-indicators.ts`](../apps/web/src/hooks/use-indicators.ts)
- [`apps/web/src/hooks/use-event-stream.ts`](../apps/web/src/hooks/use-event-stream.ts)
- [`apps/web/src/hooks/use-connection-monitor.ts`](../apps/web/src/hooks/use-connection-monitor.ts)
- [`apps/web/src/hooks/use-build-mismatch.ts`](../apps/web/src/hooks/use-build-mismatch.ts)
- [`apps/web/vite.config.ts`](../apps/web/vite.config.ts) — `__OPENPORTAL_BUILD_ID__` injection
