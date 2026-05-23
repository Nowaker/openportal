# 'Session may be wedged' banner - source + accuracy

User asked (2026-05-23) where the "Session may be wedged - OpenCode
reports busy but no streaming progress" banner with the "Abort +
retry" button comes from, and whether it's accurate.

## Source: OpenPortal LOCAL HEURISTIC, not stuck-detector

Lives in [`apps/web/src/routes/_app/session/$id.tsx:3706-3717`](../apps/web/src/routes/_app/session/$id.tsx#L3706-L3717).

```ts
const stallVerdict = useMemo<
  "silent" | "no-dispatch" | "stuck-busy" | null
>(() => {
  if (!isAssistantBusy) return null;
  if (!busyIdleSince) return null;
  const age = Date.now() - busyIdleSince;
  if (age < DISPATCH_GRACE_MS) return "silent";          // < 30s
  if (!isServerBusy) return "no-dispatch";                // 30s+ idle on server
  if (age >= STUCK_BUSY_THRESHOLD_MS) return "stuck-busy"; // 5min+ busy
  return null;
}, [...]);
```

Triggers `stuck-busy` when ALL of:
1. `isAssistantBusy` (client-side flag) is true
2. `isServerBusy` (server confirms busy) is true
3. `age >= 5 minutes` since `isAssistantBusy` first became true

## Accuracy problems

1. **Purely time-based.** It doesn't check if streaming progress is
   actually happening - just measures how long the busy flag has been
   true. A long-running `bash`/network/API tool call that legitimately
   takes 5+ minutes would trigger the banner falsely.
2. **5min threshold is arbitrary.** Some users run long-running jobs
   intentionally (database migrations, large `bun install`, etc.).
3. **No probe of `message.part.delta` cadence.** The banner says
   "no streaming progress" but the heuristic never actually
   inspects whether deltas are arriving. It only checks the
   server's `busy` boolean.
4. **Predates stuck-detector integration.** Stuck-detector plugin
   has authoritative verdicts (`idle` / `in-progress` / `stuck`
   with specific causes like `stale-stream`, `no-runner`, etc.) that
   it derives by probing opencode's DB + runtime - a real signal,
   not a wall-clock guess.

## Stuck-detector path (the authoritative one)

[`apps/web/src/routes/_app/session/$id.tsx:5431-5450`](../apps/web/src/routes/_app/session/$id.tsx#L5431-L5450):

```ts
{sessionIndicator?.stuck_verdict === "stuck" &&
  sessionIndicator.stuck_cause &&
  stallVerdict === null && (
    <StuckBanner cause={...} retry={...} sessionID={...} ... />
  )}
```

A SEPARATE banner renders when the stuck-detector verdict is `stuck`.
But it's gated by `stallVerdict === null`, so the LOCAL heuristic's
banner WINS when both are true. That gating is documented in the
comment at line 143-146 as "Plugin-driven stuck banner (Section B)"
— a Section B feature that the local stallVerdict effectively
masks.

## Recommended decision points (user calls these)

1. **Drop the local `stuck-busy` branch entirely** and rely on the
   stuck-detector verdict instead. Pro: removes a noisy heuristic.
   Con: loses banner when stuck-detector is unreachable / not
   loaded.
2. **Keep both but reverse the priority**: stuck-detector verdict
   wins, local heuristic is a fallback when verdict is null. The
   gating at line 5433 would invert.
3. **Lift `STUCK_BUSY_THRESHOLD_MS` from 5min to something larger**
   (15-30min) so it only catches genuine wedges, not long-running
   legitimate tool calls.
4. **Add streaming-delta probe**: track timestamp of last
   `message.part.delta` event; only trigger the local heuristic if
   THAT goes stale, not just `busy` age. This makes the local
   heuristic actually do what its banner text claims.

The `no-dispatch` branch (line 5382) has its own analysis - it
fires at 30s+ when server is idle but client thinks busy. That one
catches actual dispatch failures (rare since the pending-prompt-
worker landed). Worth keeping unless the dual stuck-detector path
covers it too.

## Suggested approach (just a recommendation)

Option (2) + (4) combined: stuck-detector wins; local heuristic
becomes a true wall-clock + delta-cadence probe and is hidden when
the plugin is loaded and emitting verdicts. Best of both worlds.

User decides.
