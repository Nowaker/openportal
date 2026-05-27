# Stuck-detector verdict frozen at `in-progress` for cleanly-completed sessions

> **STATUS: FIXED** — opencode-tools commit
> [`dea56e7`](https://gitlab.com/Nowaker/opencode-tools/-/commit/dea56e7)
> ("stuck-detector: downgrade in-progress/stuck verdicts to idle on
> clean completion"). The leader's `scanDbStuckCauses` now emits an
> idle-transition delta when a cached non-idle verdict's session has
> left `allBusy` and the fresh DB classification is idle. Live `/verdicts/stream`
> subscribers update without needing a portal restart. Six new unit
> tests cover the path.
>
> **Operational requirement**: the fix only takes effect after the
> leader opencode (`opencode-serve-lan.service`, port 4098) restarts
> and reloads the plugin code. Until then portal will keep showing
> the frozen `in-progress` badges. Restarting that one service is
> sufficient; the worker on `opencode-serve-tailscale.service` picks
> up new state via `/verdicts` on next scan tick.

User report (2026-05-27, ~09:42 CDT):

> What is the current state of session
> https://portal.desktop.ts.nowaker.net:8443/session/ses_1982abce8ffezvjg4sZJArAJGZ?server=srv-2dy1srwz?
> Portal is showing it as in progress. What does stuck detector say about
> it? And if the session is idle / done with everything, why is portal
> showing it as in progress? Is it cached on the database? Why didn't it
> update it over these many hours?

This document captures the full investigation. **No portal state
mutation performed.** Fix landed in opencode-tools as documented
above.

## TL;DR

The session is **idle** and **opencode considers the turn cleanly
completed**. Portal renders "in progress" because the
**stuck-detector plugin's verdict for this session is frozen at
`in-progress`** and never gets downgraded to `idle` when a session
finishes normally.

The frozen verdict propagates through:

`opencode-stuck-detector plugin /verdicts` →
`apps/web/src/server/plugins/stuck-detector-client.ts` →
`indicator-state.applyStuckVerdict()` →
`/api/indicators` → `session-status.ts` → UI "busy" badge

The portal-side cache (SQLite `messages_cache` / `sessions_cache`)
is **NOT** the source of the bug. Portal's own `busy`/`idle` flag
is correct. The bug is in the **stuck-detector leader's scan loop**
in `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts`.

## Evidence chain (top to bottom, authoritative sources)

### 1. Opencode considers this session DONE

Server `srv-2dy1srwz` → `100.105.229.19:4096` (per
`~/.openportal/openportal.json`).

```
$ curl -sS http://100.105.229.19:4096/session/status | jq '.["ses_1982abce8ffezvjg4sZJArAJGZ"]'
null
```

Empty: opencode's runtime busy map does NOT list this session.

```
$ curl -sS http://100.105.229.19:4096/session/ses_1982abce8ffezvjg4sZJArAJGZ/message \
    | jq '.[-1].info.time'
{ "created": 1779862415183, "completed": 1779862477787 }
```

Last assistant message `msg_e6811274f0010U7j8gTQXbw2HQ` has
`time.completed=1779862477787` (NOT null) =
**2026-05-27 01:14:37 AM CDT**. ~8.5 hours before the user's report.

### 2. Portal's `busy`/`idle` is CORRECT

`/api/indicators` for this session:

```json
{
  "serverId": "srv-2dy1srwz",
  "sessionId": "ses_1982abce8ffezvjg4sZJArAJGZ",
  "busy": false,
  "idle": true,
  "inFlightAssistantId": null,
  "lastEventAt": 1779861893595,
  ...
  "stuck_verdict": "in-progress",   <-- BAD: this is what drives the UI
  "stuck_cause": null,
  "stuck_warnings": [],
  ...
}
```

`busy=false`, `idle=true`, `inFlightAssistantId=null` — all correct.
Portal received the `message.updated` SSE event when the message
completed and cleared the in-flight assistant. The disconnect is
entirely on `stuck_verdict`.

### 3. UI badge is driven by `stuck_verdict`, not `busy`

[`apps/web/src/lib/session-status.ts:217`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/lib/session-status.ts#L217):

```typescript
const runtimeBusy = state.busy || state.stuck_verdict === "in-progress";
```

[`apps/web/src/hooks/use-opencode.ts:142`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/hooks/use-opencode.ts#L142):

```typescript
if (s.busy || s.stuck_verdict === "in-progress") return { type: "busy" };
```

`stuck_verdict === "in-progress"` is sufficient to render the
session as busy in BOTH the badge logic AND the session-status
hook. With `busy=false` but `stuck_verdict="in-progress"`, every
consumer treats this session as running.

### 4. Portal mirrors a stale verdict from the stuck-detector plugin

The plugin lives inside opencode itself. Two opencodes are running:

| Service                          | PID     | Hostname          | Port | Role                       |
| -------------------------------- | ------- | ----------------- | ---- | -------------------------- |
| opencode-serve-lan.service       | 1575442 | 192.168.10.10     | 4096 | stuck-detector **leader**, listens on `127.0.0.1:4098` |
| opencode-serve-tailscale.service | 1575812 | 100.105.229.19    | 4096 | stuck-detector **worker** `nwkr-desktop-1575812-4096` |

Both services started 2026-05-26 22:34:57 CDT (~11h ago). Neither
has restarted since. The session ran on the tailnet opencode
(`100.105.229.19:4096`) — confirmed by the `workerID` field in
the verdict.

Direct query to the plugin source:

```
$ curl -sS http://127.0.0.1:4098/verdicts | jq '.["ses_1982abce8ffezvjg4sZJArAJGZ"]'
{
  "sessionID": "ses_1982abce8ffezvjg4sZJArAJGZ",
  "verdict": "in-progress",
  "stuck_cause": null,
  "warnings": [],
  "directory": "/home/nowaker/projekty/webapps/portal",
  "in_flight_msg_id": "msg_e6811274f0010U7j8gTQXbw2HQ",
  "idle_seconds": 2,
  "threshold_seconds": 504,
  "queued_user_msgs": 0,
  "opencode_runtime_busy": true,                  <-- BAD: opencode says false now
  "owner_instance_url": null,
  "sse_last_part_updated_ms": null,
  "sse_last_status_kind": null,
  "workerID": "nwkr-desktop-1575812-4096",
  "computed_at_iso": "2026-05-27 06:14:33Z",      <-- frozen at 01:14:33 CDT
  "last_event_at_ms": null,
  "last_event_type": null,
  "last_action_at_ms_by_cause": {}
}
```

- `computed_at_iso: "2026-05-27 06:14:33Z"` = **2026-05-27 01:14:33 AM CDT**.
  That's 4 seconds BEFORE the message completed at 01:14:37 AM CDT.
- `in_flight_msg_id` = the same message that has since completed.
- `idle_seconds: 2` — frozen at the value it had at computation time.
- `opencode_runtime_busy: true` — frozen; the LIVE opencode now says
  this session is NOT busy.
- `last_event_at_ms: null` — the leader has never received an SSE
  event for this session (the worker tracks runtime busy via HTTP
  polling, not in-process SSE for this aggregator).

The verdict was correct AT THE MOMENT IT WAS COMPUTED. But the
moment opencode finalized the message ~4 seconds later, no scan
path updated the stored verdict, and it has stayed frozen ever
since.

### 5. The same pattern in other sessions

Quick scan of every `verdict === "in-progress"` entry in the
plugin's snapshot:

```
sid                          verdict      computed_at_iso        last_event_at_ms  opencode_busy
ses_19873d970ffeUuFp3U2eNgwzrG  in-progress  2026-05-27 14:48:34Z   1779860508302     true   <-- LIVE, currently busy
ses_198683d51ffedHVSPDC19aqP6o  in-progress  2026-05-27 09:51:05Z   null              true   <-- FROZEN
ses_1983566f5ffemNKO0R8Bm8e1Go  in-progress  2026-05-27 05:57:37Z   null              true   <-- FROZEN
ses_1982abce8ffezvjg4sZJArAJGZ  in-progress  2026-05-27 06:14:33Z   null              true   <-- FROZEN (user's report)
ses_1961e22d6ffezKJ1qsw7wUXhju  in-progress  2026-05-27 14:48:34Z   null              true   <-- LIVE, recent scan
```

Three frozen "in-progress" verdicts. All have
`opencode_runtime_busy: true` and `last_event_at_ms: null` —
indicating the verdict was last touched while opencode reported
the session as busy, then never re-evaluated after opencode
flipped to idle. **This is not a one-off; it's a class.**

## Root cause: the leader scan loop has no `in-progress → idle`
## transition path

[`opencode-stuck-detector/plugin.ts:500-514`](file:///home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts#L500):

```typescript
async function leaderTick(state: RuntimeState): Promise<void> {
  gcStaleWorkers(state);
  const allBusy = new Map<...>();
  for (const [workerID, w] of state.workers) {
    const busy = await collectWorkerBusy(w.instanceUrl);
    w.ownBusy = busy;
    for (const [sid, entry] of Object.entries(busy)) {
      allBusy.set(sid, { workerID, instanceUrl: w.instanceUrl, ...entry });
    }
  }
  await scanBusyVerdicts(state, allBusy);
  await scanNoRunner(state, allBusy);
  await scanDbStuckCauses(state, allBusy);
  scanRetryOverdue(state, allBusy);
  await autoActLoop(state);
}
```

- `collectWorkerBusy` HTTP-polls each worker's `/session/status?directory=<wt>`
  to build `allBusy` — the set of sessions opencode currently
  considers running.

[`scanBusyVerdicts` (plugin.ts:639-654)](file:///home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts#L639):

```typescript
async function scanBusyVerdicts(state, allBusy) {
  const db = ensureDb(state);
  if (!db) return;
  const sseFile = state.cfg.sse_state_file;
  for (const [sid, owner] of allBusy) {            // <-- only iterates BUSY sessions
    const dbState = detect(db, sid);
    if (!dbState) continue;
    dbState.opencode_runtime_busy = owner.type === "busy" || owner.type === "retry";
    if (sseFile) applySseFusion(dbState, sseFile);
    const vs = upsertVerdict(state, dbState, owner.workerID);
    state.server?.broadcastDelta(vs);
  }
}
```

Iterates **only** sessions present in `allBusy`. As soon as
opencode drops a session from its runtime busy map (which it does
the moment the last assistant message completes cleanly), this
function stops touching it.

[`scanDbStuckCauses` (plugin.ts:656-679)](file:///home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts#L656):

```typescript
async function scanDbStuckCauses(state, allBusy) {
  const db = ensureDb(state);
  if (!db) return;
  const sseFile = state.cfg.sse_state_file;
  const ids = listAllSessionIds(db);
  for (const sid of ids) {
    if (allBusy.has(sid)) continue;                // skip busy (handled above)
    const dbState = detect(db, sid);
    if (!dbState) continue;
    if (sseFile) applySseFusion(dbState, sseFile);
    if (dbState.verdict !== "stuck") continue;     // <-- only emit when fresh state is STUCK
    if (dbState.stuck_cause === "no-runner") continue;
    dbState.opencode_runtime_busy = false;
    const prev = state.verdicts.get(sid);
    const vs = upsertVerdict(state, dbState, prev?.workerID ?? "");
    if (!prev || prev.stuck_cause !== vs.stuck_cause || prev.verdict !== vs.verdict) {
      logLine(...);
      state.server?.broadcastDelta(vs);
    }
  }
}
```

Iterates **all** non-busy sessions, computes a fresh DB verdict,
and only acts when the fresh verdict is `"stuck"`. When the fresh
verdict is `"idle"` (clean completion), the function `continue`s
and **leaves the previously-cached verdict in `state.verdicts`
untouched**.

`scanNoRunner` is the symmetric path for stuck sessions whose
runner has died — same gating: only emits when the verdict is
`"stuck"`.

**Net effect**: the only verdict transition the leader supports for
a non-busy session is `idle/in-progress → stuck` or
`stuck → stuck-with-different-cause`. The clean-completion path
`in-progress → idle` is **not implemented**.

## Why doesn't portal recover on its own?

[`apps/web/src/server/plugins/stuck-detector-client.ts:90-120`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/plugins/stuck-detector-client.ts#L90)
normalizes incoming verdicts and rejects anything where
`verdict` is not one of `idle | in-progress | stuck`. If the plugin
DID emit an `idle` verdict (it doesn't), portal would correctly
overwrite the cached `in-progress`. The plugin emits
**no transition at all**, so portal has nothing to react to.

[`indicator-state.applyStuckVerdict()`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/lib/indicator-state.ts#L454)
overlays the incoming verdict on every matching indicator entry.
It has no time-based decay — verdicts only change via incoming
deltas. On portal restart, the seed comes from `GET /verdicts`
which still contains the frozen `in-progress` entry; portal
re-seeds the bug.

Portal's per-session `/api/stuck-detector/verdict/<sid>` is a
**pure proxy** to the plugin's `/verdicts/<sid>` — it doesn't
compute anything portal-side.

## Why doesn't `idle_seconds=2` decay?

`idle_seconds` is a snapshot value computed at scan time. It is
NOT a live counter on the wire. The plugin computes it as
`(scan_time - last_db_part_time_updated) / 1000` and stores it in
the verdict. Because the verdict is never re-computed for this
session after the message completion, `idle_seconds` stays at the
value it had at the very last scan tick. Same for
`opencode_runtime_busy`, `in_flight_msg_id`, etc. — they are all
snapshot fields, not live signals.

## Is the SQLite cache responsible?

No. Portal's `~/.local/share/openportal/openportal.db` has two
cache tables:

- `sessions_cache` — last refreshed at `2026-05-27 09:41:42 CDT`
  (1 minute before the user's report). Carries session
  list/metadata (title, time.updated, etc.). Does NOT carry any
  "is the session currently busy" field.
- `messages_cache` — for this session, last refreshed at
  `2026-05-27 09:38:46 CDT` (3 minutes before the report). 80
  messages. Last message's `info.time.completed` is correctly
  set to `1779862477787`.

Both caches reflect the truth. The "in-progress" UI signal does
not flow through them; it flows through the in-memory
`indicator-state` Map, which carries `stuck_verdict` sourced from
the plugin.

## Why has it persisted "many hours"?

The leader scan tick runs every `scan_interval_ms` (default
plugin config). Every tick:

1. Re-polls each worker's runtime busy map → `allBusy`.
2. Calls `scanBusyVerdicts(allBusy)` — does not include this session.
3. Calls `scanDbStuckCauses(allBusy.complement)` — this session is
   in the complement (DB has no stuck cause), function continues
   without updating.
4. Other scans — none of them downgrade.

So every ~5 seconds, the bug is "re-confirmed" by inaction. The
stale verdict has now been the published state of this session
for ~8.5 hours.

## Recommended fixes (NOT applied, investigation only)

Two layers can each fix this independently:

### Fix 1 (preferred): Leader emits `idle` transitions

Modify `scanDbStuckCauses` (or add a new `scanIdleTransitions`)
to:

```typescript
for (const sid of ids) {
  if (allBusy.has(sid)) continue;
  const dbState = detect(db, sid);
  if (!dbState) continue;
  if (sseFile) applySseFusion(dbState, sseFile);

  const prev = state.verdicts.get(sid);

  // NEW: downgrade in-progress -> idle when DB says idle and
  // opencode no longer reports busy.
  if (prev && prev.verdict === "in-progress" && dbState.verdict === "idle") {
    dbState.opencode_runtime_busy = false;
    const vs = upsertVerdict(state, dbState, prev.workerID ?? "");
    state.server?.broadcastDelta(vs);
    continue;
  }

  // EXISTING: only-stuck path stays unchanged.
  if (dbState.verdict !== "stuck") continue;
  if (dbState.stuck_cause === "no-runner") continue;
  ...
}
```

Authoritative: the leader has both the DB state and the runtime
busy map. The plugin can confidently say `idle`.

### Fix 2 (cheaper): Portal proactively clears stuck_verdict on
### message completion

When `indicator-state.applyOpencodeEvent` handles the
`message.updated` event and sees a clean completion
(`info.time.completed != null`) for the in-flight assistant, also
clear `stuck_verdict` if it was `in-progress`:

```typescript
// in case "message.updated", after clearing inFlightAssistantId etc.
if (next.stuck_verdict === "in-progress") {
  next.stuck_verdict = null;
}
```

This is defensive: portal already knows the message finished
cleanly; ignoring the plugin's stale signal locally is reasonable.
Downside: opens a window for plugin/portal to disagree on cause
attribution; the leader-fix is the cleaner answer.

### Fix 3 (cosmetic): Cap verdict freshness

If `computed_at_iso` is older than, say, 5 minutes and the session
is not in `allBusy`, downgrade the cached verdict to `idle` on
the portal side. Pure UX safety net.

## Verification (read-only) steps used

All commands run with no state mutation:

```bash
# 1. server -> opencode mapping
jq '.servers[] | select(.id == "srv-2dy1srwz")' ~/.openportal/openportal.json

# 2. opencode session state
curl -sS http://100.105.229.19:4096/session/status | jq '.["ses_1982abce8ffezvjg4sZJArAJGZ"]'
curl -sS http://100.105.229.19:4096/session/ses_1982abce8ffezvjg4sZJArAJGZ/message \
  | jq '.[-1].info.time'

# 3. portal indicator state
curl -sS http://100.105.229.19:5000/api/indicators \
  | jq '.sessions[] | select(.sessionId == "ses_1982abce8ffezvjg4sZJArAJGZ")'

# 4. plugin verdict (authoritative source)
curl -sS http://127.0.0.1:4098/verdicts | jq '.["ses_1982abce8ffezvjg4sZJArAJGZ"]'
curl -sS http://100.105.229.19:5000/api/stuck-detector/verdict/ses_1982abce8ffezvjg4sZJArAJGZ

# 5. cache state (no busy field carried, just for completeness)
sqlite3 ~/.local/share/openportal/openportal.db \
  "SELECT session_id, fetched_at, message_count,
          datetime(fetched_at/1000, 'unixepoch', 'localtime') AS fetched_local
   FROM messages_cache
   WHERE session_id = 'ses_1982abce8ffezvjg4sZJArAJGZ';"
```

## File index (deep links)

Portal:
- [`apps/web/src/lib/session-status.ts:217`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/lib/session-status.ts#L217) — runtimeBusy decision
- [`apps/web/src/hooks/use-opencode.ts:141-142`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/hooks/use-opencode.ts#L141) — session-state classifier
- [`apps/web/src/server/lib/indicator-state.ts:454-481`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/lib/indicator-state.ts#L454) — `applyStuckVerdict()`
- [`apps/web/src/server/plugins/stuck-detector-client.ts:122-139`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/plugins/stuck-detector-client.ts#L122) — `fetchSnapshot()`
- [`apps/web/src/server/stuck-detector/verdict/[id].get.ts`](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/stuck-detector/verdict/%5Bid%5D.get.ts) — per-session proxy

Stuck-detector plugin (opencode-tools):
- [`opencode-stuck-detector/plugin.ts:500-514`](file:///home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts#L500) — `leaderTick`
- [`opencode-stuck-detector/plugin.ts:639-654`](file:///home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts#L639) — `scanBusyVerdicts` (only busy)
- [`opencode-stuck-detector/plugin.ts:656-679`](file:///home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts#L656) — `scanDbStuckCauses` (only stuck)
- [`_lib/stuck-detector/state.ts:80-110`](file:///home/nowaker/projekty/nowaker/opencode-tools/_lib/stuck-detector/state.ts#L80) — VerdictState shape

## Open questions for the user

1. Fix location preference: leader fix (Fix 1) is the authoritative
   answer but lives in opencode-tools, not portal. Fix 2 keeps the
   patch inside portal and lands faster. Which scope do you want?
2. The leader's stale-verdict population covers other in-progress
   verdicts (`ses_198683d51`, `ses_1983566f5`). Do we want a
   bulk-clear pass at portal startup (one-time hygiene) in addition
   to the structural fix?
3. Does the recommended fix need to extend to the
   `last_action_at_ms_by_cause` field (clearing it on
   `in-progress → idle`) to avoid stale cooloff history?
