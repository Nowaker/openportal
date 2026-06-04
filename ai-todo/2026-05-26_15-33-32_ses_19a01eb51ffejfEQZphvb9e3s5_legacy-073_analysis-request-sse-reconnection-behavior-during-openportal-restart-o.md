---
status: DONE
session: ses_19a01eb51ffejfEQZphvb9e3s5
queued_at: 2026-05-26T15:33:32-05:00
legacy_number: 73
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Analysis request: SSE reconnection behavior during OpenPortal restart / opencode unavailable

User prompt (verbatim):

> in an event of "OpenPortal updated - reload to upgrade" alert - when openportal restarts - what happens to the frontend when i have an active session opened, one that is working, and supposedly has an active sse stream?
> or when 'opencode not available'
> will it miss the updates in between? say last i saw was message in sequence number 5, then something happened in the meantime, and now the latest would be number 10 in sequence. will openportal receive everything in between?
> I've noticed updates very flakey at times, and i sometimes f5 to see if real progress happened.

Design notes:
- Analysis-only task per portal AGENTS.md "Analysis / deep-explanation requests" protocol. No code changes.
- Full investigation persisted to `ai-analysis-requests/SSE_RECONNECTION_BEHAVIOR.md`.
- TL;DR: Three SSE streams (`/api/indicators/stream`, `/api/opencode/<port>/event`, `/api/stuck-detector/events/stream`). NO sequence numbers, NO `Last-Event-ID`, NO server-side replay. Events in the gap are permanently lost on the wire.
- Convergence mechanisms: (1) `/api/indicators/stream` sends a fresh `snapshot` frame on every reconnect with current state, scoped to the consumer's filter. (2) `useConnectionMonitor` fires global `mutate(() => true)` on `down → connected` transition, refetching every SWR key. Net: user sees correct final state, but loses intermediate trajectory (token-by-token deltas, transient busy badges).
- "OpenPortal updated" banner = 60s poll of `X-OpenPortal-Build` header in `use-build-mismatch.ts`. Polling, not event-driven. One-way trapdoor (never resets). No auto-reload.
- "OpenCode unavailable" banner = 10s probe of `/api/instance/self` reading `health.opencode` field. 2-consecutive-fail threshold before flipping to openportal-down. 15s per-probe timeout (note: this differs from the AGENTS.md "5s timeout" claim; the actual code uses 15_000ms — worth a documentation fix in a separate todo).
- F5 flakiness explanation: `EventSource` can be silently dead (no events arriving) while `/api/instance/self` still reports connected. The monitor sees no state transition, fires no global refetch, and SWR sits on stale data. F5 = fresh EventSource + fresh SWR cache. No watchdog detects this case today.
- Recommended follow-up (NOT auto-queued; for user review): add a per-stream heartbeat watchdog in `use-indicators.ts` and `use-event-stream.ts`. Track last-event-received timestamp; if it exceeds 2x the server's heartbeat interval (~60s for indicators), force-close + reopen + fire `mutate(() => true)`. ~50 lines. Closes the silently-dead-socket gap that F5 currently fixes.
- AGENTS.md "Connection resilience" section says probe timeout is 5s; actual code at `use-connection-monitor.ts:7` is `PROBE_TIMEOUT_MS = 15_000`. Doc-vs-code drift; worth a separate quick-fix entry if the user wants the docs aligned.
