---
status: DONE
session: ses_1982abce8ffezvjg4sZJArAJGZ
queued_at: 2026-05-27T00:08:11-05:00
legacy_number: 86
commits:
  attributed:
    - ef26452219b0
  on_main:
    - ef26452219b0
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Cache warmth: stop wiping messages cache on every delta + don't clear stale content on transient fetch errors

User prompt (verbatim):

> https://portal.desktop.ts.nowaker.net:8443/session/ses_1983566f5ffemNKO0R8Bm8e1Go
>
> I created this session a couple minutes ago here from within openportal. Then I navigated away to create this session.
>
> I noticed that every time I return to a session I created, or which I subsequently prompted in and then left and opened a different session, when I return, I will first see only cached content. Nothing that happened in between. It  will take 15-45s for anything to show up. And there will be no indicator that we're loading in between leigress. There is also no in progress indicator (yellow bubble) in the side bar. I feel like when I leave the session out of view, in progress indicator on the sidebar for that session will never show up. I also feel like when portal frontend removed a session out of view, the underlying sse stream on portal backend closes. This is incorrect  it should continue to feed its cache continuously and update it so wheb I go back to the session in portal frontend, it will take a no time to render the cached responses, and then only the very very very latest stuff may come with a delay from a slower opencode instance.
>
> Also. I sometimes see error cannot fetch messages. It happens very rarely. How is this different from other situations where we say either opencode down or openportal down? It should show up like that. Fetch errors don't belong there. Especially if they're to clear existing content there!

Design notes:

- **Root cause** of the 15-45s blank-window-on-return + "no progress" complaint: `apps/web/src/server/plugins/indicator-broadcaster.ts` calls `invalidateMessagesCache(sessionId)` on EVERY `message.part.delta` / `message.part.updated` / `message.part.removed` / `message.updated` / `message.removed` event. `invalidateMessagesCache` is destructive on BOTH layers (in-memory LRU AND SQLite via `deleteFromDb`), so during an active assistant turn the cache is being constantly wiped. The session-prefetcher refills only every 60s for in-flight sessions, and only with `LONG_LIVED_TTL_MS = 5min` — so when the user leaves a session under streaming load and returns ~minutes later, the cache is empty and the backend has to do a synchronous opencode round-trip against a session that may carry tens of MB of messages.
- This DIRECTLY violates the caching-proxy invariant the user spelled out and the file's own preamble: *"Only when you hear from opencode AUTHORITATIVELY (not a fucking timeout or empty array due to a bug or something) that it's not there, should you update your cache."* A `message.part.delta` is "this message changed", not "this message is gone".
- **Fix shape**:
  1. **New module `apps/web/src/server/lib/messages-refresh.ts`** — extract `fetchAndCache` + all the strip helpers (`stripDiagnosticFixes`, `stripUserMessageSummary`, `stripPartBloat`, `stripOmoFromUserText`, `attachPermissionDecisions`, `rewriteImageDataUrls`, `stripHeavyInputFields`, etc.) from `messages.ts` into a shared module. Both the foreground handler and the broadcaster's background refresh call into the same path so the cache contents stay byte-identical regardless of which producer last wrote.
  2. **`messages.ts`** keeps the handler (`loadFullMessages`, virtual-prompt dedup, etc.) but imports `fetchAndCacheMessages` from the new module.
  3. **`indicator-broadcaster.ts`** stops calling `invalidateMessagesCache` on `message.part.delta` / `message.part.updated` / `message.updated`. Those events now schedule a **leading-edge debounced background refresh** per session: 1500ms throttle, one refresh per session per window. Cache stays continuously warm under streaming load; user returning to a session sees the freshest authoritative state immediately, no blocking opencode call needed.
  4. Authoritative removals — `message.removed`, `message.part.removed`, `session.deleted` — keep destructive semantics. `invalidateMessagesCache` is the right tool there because the cache merger's existing append-only behavior would otherwise resurrect the removed item.
  5. **Frontend** (`apps/web/src/routes/_app/session/$id.tsx`): gate the destructive `Error: ...` banner on `messages.length === 0`. When stale/cached content is already on-screen, a single failed SWR poll (transient 5xx, network blip) must NOT paint a red banner over the user's chat — the next poll will likely succeed; `keepPreviousData: true` keeps the prior data; the cache fix above plus the existing yellow `ConnectionStatusBanner` already cover the "really down" case.
- **Sidebar in-progress indicator**: the data path (`indicator-broadcaster` → `indicator-state` → `useIndicators` → `useSessionStatus`) is correct as-is — `message.created` for an assistant message sets `busy=true` on the indicator state and propagates via the singleton SSE. If the user still sees missing indicators after the cache fix lands, the issue is more likely the sidebar's `useSessions` SWR cache being stale (the sessions list doesn't auto-refresh just because a session went busy in another tab) than a propagation bug. Defer that probe pending repro on the deployed fix.
- **Refresh debounce timing** (1500ms): tradeoff between cache freshness and opencode load. Streaming bursts can emit 5-10 deltas/sec — at 1.5s throttle, that's one full-history refetch per ~10 deltas. The 12k-message session is the worst case (~35MB JSON) and gets one refetch per 1.5s during streaming. Cache stays within ~1.5s of opencode reality. Adjustable via `REFRESH_DEBOUNCE_MS` constant.
- **Throttle pattern**: leading-edge — first event in a burst schedules the timer; subsequent events within the window are coalesced. This guarantees the cache refreshes promptly (within `REFRESH_DEBOUNCE_MS` of the first event) and bounds the rate. Same pattern as the chunked-strategy flushTimers in `use-event-stream.ts`.
- **Concurrency**: `inFlight` map in `messages-refresh.ts` serializes refreshes per-session so two timers landing simultaneously don't stack two SDK calls on the same session.
- Worktree: `~/projekty/webapps/portal-cache-warmth` (branch `cache-warmth-fix`).

---
