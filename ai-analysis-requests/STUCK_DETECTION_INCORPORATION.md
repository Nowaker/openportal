# Stuck Detection Incorporation

How openportal currently determines `Server is idle - prompt accepted but
generation never started`, what's wrong with it, and a concrete plan to
replace it with the richer vocabulary from
`~/projekty/nowaker/opencode-tools/opencode-stuck-detector`.

## 1. How openportal classifies "stuck" today

Implementation: `apps/web/src/routes/_app/session/$id.tsx:3389-3433`.

```ts
const DISPATCH_GRACE_MS = 30_000;
const STUCK_BUSY_THRESHOLD_MS = 5 * 60_000;

const stallVerdict = useMemo<"silent" | "no-dispatch" | "stuck-busy" | null>(() => {
  if (!isAssistantBusy) return null;
  if (!busyIdleSince) return null;
  const age = Date.now() - busyIdleSince;
  if (age < DISPATCH_GRACE_MS) return "silent";
  if (!isServerBusy) return "no-dispatch";
  if (age >= STUCK_BUSY_THRESHOLD_MS) return "stuck-busy";
  return null;
}, [isAssistantBusy, busyIdleSince, isServerBusy, stallElapsedTick]);
```

Two inputs:

| Input | Source | What it means |
|---|---|---|
| `isAssistantBusy` | `$id.tsx:3344` — derived from `messages` array. `true` iff the latest message is a user msg with no assistant successor OR is an assistant msg with no `time.completed`. | Local: "we expect a turn to finish but it hasn't" |
| `isServerBusy` | `useSessionStatus()` from `apps/web/src/hooks/use-opencode.ts:124-142`. Wraps `useIndicators({serverId})` from the SSE indicator stream. Returns `{type: "busy" | "idle"}` per session. | Server: "opencode's runtime says this session is being processed right now" |

`busyIdleSince` is captured at the moment `isAssistantBusy` flips to true and reset when it flips off. `age = Date.now() - busyIdleSince` is the elapsed time since openportal first noticed the busy condition.

Three banner states:

- `silent` (age < 30s): no banner. The dispatch grace prevents false positives during the LLM time-to-first-token window.
- `no-dispatch` (age ≥ 30s AND opencode says idle): banner reads `Server is idle - prompt accepted but generation never started.` + Resubmit / Restore buttons. Renders at `$id.tsx:5064-5093`.
- `stuck-busy` (age ≥ 5min AND opencode says busy): different banner with Abort+Retry. Renders at `$id.tsx:5096+`.

`null` (between 30s and 5min while opencode says busy): no banner. "Streaming is slow but progressing" window.

## 2. Why it false-positives

Three independent failure modes can all trigger a false `no-dispatch`:

### 2a. SSE indicator stream lag / desync

`useSessionStatus()` is now fed by the SSE indicator stream
(`apps/web/src/hooks/use-indicators.ts` + the broadcaster on the server,
documented in `apps/web/src/hooks/use-opencode.ts:97-114`).

Failure modes:

- The SSE connection drops momentarily (server restart, network blip).
  Between drop and reconnect the indicator state is stale: a session
  that flipped to busy on the opencode side never reaches the browser
  and `isServerBusy=false`.
- The broadcaster's bootstrap sweep on connect lists sessions only for
  the projects opencode currently knows about. If a session lives in a
  project whose worktree isn't in `/project`, it's invisible until a
  new event for that session fires.
- `session.idle` / `session.busy` events from opencode's `/event` SSE
  are the only flip triggers. If opencode misses emitting one (rare but
  observed in the wild — see `tmp/last-3-days-substantive.md` lines
  1980, 2117, 2454), the indicator stays at its last value forever.

### 2b. `isAssistantBusy` over-triggers on aborted/errored turns

Logic at `$id.tsx:3344-3352`: `true` if the last message has no
`time.completed`. A turn that aborted with `MessageAbortedError` or
errored with `error.name=ContextOverflowError` typically gets
`time.completed=null` AND `finish=null` AND `error=<set>`. openportal
treats this as "still busy" forever; opencode-side it's clearly done.

Reproduces every time the user clicks Stop or the LLM hits a context
overflow. The session sits in `isAssistantBusy=true` until a new prompt
is submitted.

### 2c. Pre-SSE legacy: the `?directory=` bug

Documented in `tmp/real-prompts-full.md:1511-1604`. The old polling path
hit `GET /session/status` without `?directory=`, which returns sessions
only for opencode-serve's CWD. The new SSE indicator broadcaster fixed
this on the server-side but only if its bootstrap correctly enumerates
all projects (it does, per the indicator-broadcaster design).

If this bug regresses on the broadcaster side, every session not in the
default project shows `no-dispatch` permanently. Worth a periodic
verification — bootstrap MUST walk `GET /project` then per-project
`/session/status?directory=<wt>`.

## 3. What opencode-stuck-detector knows that openportal doesn't

Source: `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/db-detector.ts`.

Verdict vocabulary is richer:

| Verdict | Meaning |
|---|---|
| `idle` | Latest assistant finished; no queued user msg |
| `in-progress` | Streaming, compacting, tool-running, dispatching, awaiting-question |
| `stuck` | Wedged — needs action |

`stuck_cause` (set only when verdict=stuck):

| Cause | Detection |
|---|---|
| `stale-stream` | In-flight turn, heartbeat past 504s |
| `stale-compaction` | Same but `mode='compaction'` |
| `question-with-queue` | Latest part is `tool=question state.status=running` AND queued user msgs behind it |
| `no-dispatch` | Tail is user msg older than 30s with no assistant successor |
| `no-runner` | DB shows in-flight AND `/session/status` reports no runner on any project |
| `compaction-overflow` | Latest assistant has `finish='error'` AND `error.name='ContextOverflowError'` |

Plus warnings (non-blocking observations alongside any verdict).

Cross-checks the DB heartbeat against the per-instance runtime
`/session/status` to disambiguate `no-runner` (runner died, needs
resumer) from `stale-stream` (runner stuck, needs abort).

Retry-state surfacing (added in resumer commit 6287650): reads
`/session/status?directory=<wt>` directly and exposes `type=retry`
sessions with `attempt`, `next` (ms), `message`. Distinguishes
`retry-pending` (next > now, opencode is handling) from `retry-overdue`
(next < now, runtime wedged).

The shared `_lib/opencode-status/` module is the canonical helper —
`queryStatusAcrossProjects(url)` walks every project and merges the
runtime state into one map. `classifyRetry(state, now)` does the
overdue math.

## 4. The discrepancy in concrete terms

| Scenario | openportal stallVerdict | opencode-stuck-detector verdict |
|---|---|---|
| Aborted assistant message | `no-dispatch` (false positive — server is idle but for a legitimate reason) | `idle` |
| Compaction in flight | `stuck-busy` after 5 min (compactions routinely take 5+ min on 800K+ sessions) | `in-progress` with `mode=compaction` |
| Question tool blocking + queue | `null` (no banner) | `stuck` `cause=question-with-queue` |
| Runner died, DB still in-flight | After 5 min: `stuck-busy`. Before 5 min: `null` | `stuck` `cause=no-runner` immediately |
| Provider overloaded, retrying | `null` (server is busy retrying — opencode flips to busy during retry) | Retry-pending state with `attempt=N`, `next=<ms>`, surfaced via runtime status |
| Retry overdue (runtime wedged on retry loop) | `null` (still "busy") | `retry-overdue` — actionable bump candidate |
| Context overflow on compaction | `stuck-busy` after 5 min (compaction call errored, opencode flipped to idle but message has error) | `stuck` `cause=compaction-overflow` — flagged for sql-truncate or fallback-model |

The stuck-detector knows things openportal cannot infer from message
shape + busy flag alone, and openportal misclassifies several legitimate
states as either false-positive (`no-dispatch` for aborted/errored) or
under-detected (`question-with-queue` shows no banner).

## 5. The stuck-detector ALREADY runs as an opencode plugin

Missed this in the first pass. The same directory
(`~/projekty/nowaker/opencode-tools/opencode-stuck-detector`) doubles
as an opencode plugin. Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "/home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector"
  ]
}
```

What it does in-process:

- Every `opencode serve` that loads the plugin tries `Bun.serve` on
  TCP `127.0.0.1:4098`. Whichever wins is the LEADER; the rest become
  WORKERS that register with the leader via `POST /register` carrying
  their own `instanceUrl` and `workerID`.
- The LEADER owns the canonical `Map<sessionID, VerdictState>`. It
  polls each worker's `/session/status` per project on a configurable
  scan interval (default 30s) and merges into one global busy/retry/idle
  map.
- Workers forward every opencode SSE bus event to the leader via
  `POST /event`. The leader recomputes the verdict for the affected
  session and broadcasts a delta on its own SSE stream
  (`GET /verdicts/stream`).
- The HTTP API on `127.0.0.1:4098` exposes:

  | Endpoint | Behavior |
  |---|---|
  | `GET /verdicts` | All session verdicts the leader knows about, except those whose cause has `action: "nothing"`. |
  | `GET /verdicts/:sid` | Verdict for one session. |
  | `GET /verdicts/stream` | SSE. First emits the current cache, then delta for every state change. |
  | `GET /config` / `PUT /config` | Read or replace the runtime config (validated). |
  | `POST /unstuck/:sid` | Manual recovery dispatch. Optional `{cause}` override. Returns `{action, ok, reason?}`. 409 for `question-with-queue` (never auto-acts), 502 on dispatch failure. |
  | `GET /workers` | List registered worker instances. |
  | `POST /register` | Worker registration. |
  | `POST /event` | Worker-forwarded SSE event. |

- Config file at `~/.config/opencode/nowaker-opencode-plugins/opencode-stuck-detector.json`. `fs.watch` reloads on change. Default ACTION level per cause is `"log"` - the plugin is a passive observer until the user opts in. Each cause's action can be set to `unstuck` / `kick-and-abort` / `kick-and-resume` / `abort` / `log` / `nothing`. Per-(session, cause) cooloff and per-cause `min_idle_seconds` gate auto-acts.

- Failover: if the leader dies, the next worker scan-tick that sees
  `/register` fail will retry `Bun.serve(4098)` and upgrade itself.
  Recovery within `scan_interval_ms × 3` (~90s default).

This changes the incorporation math. openportal doesn't need to ship
its OWN stuck-detector engine - it can connect to the plugin's HTTP
API as a CONSUMER. That's a much smaller surface.

## 6. Plan for incorporation

Four options, ordered by effort. **Recommended**: Option D (consume the
plugin's HTTP API). Falls back to Option B if the plugin isn't installed.

### Option A — Frontend-only port

Re-implement the stuck-detector classification in TypeScript inside
openportal's existing indicator broadcaster. Use the same DB queries
opencode-stuck-detector uses, plus the SSE indicator state for runtime
cross-reference.

Pros: no new daemon, no new HTTP boundary, fully self-contained.
Cons: code duplication. Threshold drift over time. Hard to keep in
sync with opencode-stuck-detector when the latter ships new causes.

### Option B — Vendor opencode-stuck-detector as a library (RECOMMENDED)

Publish `~/projekty/nowaker/opencode-tools/opencode-stuck-detector` as
a workspace package (or symlink it into the portal monorepo's
`packages/` dir). openportal's indicator broadcaster imports the
classifier directly.

Concrete steps:

1. **Restructure stuck-detector**: extract `classify(db, sid, opencodeUrl)` into a clean library export.
   - File: `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/db-detector.ts` already exports `classify` (line 365+).
   - The peer module `_lib/opencode-status/` already exports `queryStatusAcrossProjects` and `classifyRetry`.
   - Add a top-level `index.ts` re-exporting both for a single import surface: `import { classify, classifyRetry, queryStatusAcrossProjects } from "@opencode-tools/stuck-detector"`.

2. **Wire into portal monorepo**: add the package to `packages/` (or as a turbo workspace dep). Bun supports `"file:../path"` and `"workspace:*"` dep specifiers — pick whichever matches the existing portal monorepo conventions.

3. **Server-side per-session classifier**: new file `apps/web/src/server/lib/stuck-classifier.ts`. On every indicator-broadcaster tick (or on demand via API), run `classify(db, sessionId, opencodeUrl)` for sessions in the in-flight or recently-active set. Cache result keyed by `(serverId, sessionId)` with 5-second TTL.

4. **Expose richer state to frontend**: extend `SessionIndicatorState` (currently `apps/web/src/server/lib/indicator-state.ts` or wherever) with two new fields:
   - `stuck_verdict: "idle" | "in-progress" | "stuck" | null`
   - `stuck_cause: "stale-stream" | "stale-compaction" | "question-with-queue" | "no-dispatch" | "no-runner" | "compaction-overflow" | null`
   - `retry: { attempt, next_ms, message, overdue } | null`
   The SSE delta stream emits these alongside the existing busy/idle flag. Frontend `useIndicators` already aggregates the state — no schema-breaking change required, just additive fields.

5. **Replace `stallVerdict` in `$id.tsx`**: drop the local useMemo at `apps/web/src/routes/_app/session/$id.tsx:3422-3433`. Read `indicator.stuck_verdict` + `indicator.stuck_cause` + `indicator.retry` from the unified indicator state. The banner UI selects branch per cause:

   | cause | banner copy + buttons |
   |---|---|
   | `no-dispatch` | "Prompt accepted but never dispatched. Resubmit?" + Resubmit + Restore (current text — keep it for this cause only) |
   | `stale-stream` | "Generation stalled. Abort + Retry?" + Abort + Retry |
   | `stale-compaction` | "Compaction stalled. Abort + Restart compaction?" + Abort |
   | `question-with-queue` | "Question is blocking the queue. Answer or reject above to continue." + Scroll-to-question link |
   | `no-runner` | "Generation runner died. Restart?" + Restart (calls resumer's abort+continue) |
   | `compaction-overflow` | "Compaction call overflowed context. Configure a larger compaction model or trim history." + link to settings |

   For `verdict=stuck` with `retry.overdue=true`: "Provider was retrying but the retry loop is wedged (attempt N, due Xs ago). Bump?" + Bump button (calls `POST /session/{id}/abort` against the owner instance).

6. **Drop the 5-min stuck-busy threshold**: replaced by the proper stuck-detector verdict. Stop using elapsed time as a proxy for stuckness when the actual cause is knowable.

7. **Keep `silent`-window UX**: the 30s dispatch-grace window is still useful — opencode genuinely takes 5-15s for opus-with-thinking before flipping to busy. Render banner only when `stuck_verdict === "stuck"` (filters out the silent window naturally — stuck-detector returns `idle` or `in-progress` during dispatch grace).

### Option C — External daemon

Run the stuck-detector as a separate systemd service that exposes a
loopback HTTP API. openportal calls it for verdict on demand. Highest
isolation, highest operational cost (extra unit, extra restart hooks,
extra moving piece). Not recommended - especially now that Option D
already gives you the HTTP API for free via the opencode plugin.

### Option D — Consume the in-process plugin's HTTP API (RECOMMENDED)

The plugin already runs (or can be made to run) inside the user's
`opencode-serve-tailscale` + `opencode-serve-lan` processes. Both
plugin instances on the same machine elect one leader on
`127.0.0.1:4098`. openportal is also on the same machine: just consume
that HTTP API.

Concrete steps:

1. **Make sure the plugin is loaded in BOTH user-managed opencode-serve units.** Add to `~/.config/opencode/opencode.json` (and `~/.opencode/opencode.json` if it exists per the dual-config note in opencode-tools/AGENTS.md). One line in the `plugin` array.

2. **Opt-in to per-cause actions in the plugin config** at `~/.config/opencode/nowaker-opencode-plugins/opencode-stuck-detector.json`. For openportal-driven manual actions (Resubmit / Restart / Abort+Retry buttons), leave defaults at `"log"` - the plugin observes and broadcasts state, openportal triggers actions manually via `POST /unstuck/:sid`. If the user wants auto-recovery, flip specific causes to `"unstuck"` server-side and the plugin acts on its own scan tick.

3. **openportal's indicator broadcaster connects to `http://127.0.0.1:4098/verdicts/stream` as one of its data sources.** Subscribe once per openportal process, deserialize the SSE deltas, merge into the same `SessionIndicatorState` map that the existing indicator stream feeds. Fields to add: `stuck_verdict`, `stuck_cause`, `retry`, `stuck_actionable`.

4. **Replace the local `stallVerdict`** at `apps/web/src/routes/_app/session/$id.tsx:3422-3433` with reads from the unified indicator state. UI logic stays the same shape (banner per cause) — just consumes richer data.

5. **Manual recovery actions** in the UI call openportal's existing `/api/...` proxy which forwards to the plugin's `POST 127.0.0.1:4098/unstuck/:sid` with an optional `{cause}` override. Plugin handles per-cause dispatch (abort, kick-socket, resumer's abort+continue, nudge-prompt) per the recovery-method table in the plugin README.

6. **Health gate**: if `127.0.0.1:4098` is unreachable (plugin not loaded, leader died), openportal falls back to the current local `stallVerdict` heuristic. Banner cause shows as `unknown-stuck` with a "Restart opencode plugin?" hint. This keeps openportal functional during plugin outages.

Pros:
- ZERO code duplication in openportal. The plugin is the engine.
- Plugin runs INSIDE opencode-serve — has direct access to the event
  bus (`Bus.subscribeAll`), no extra polling, sub-second resolution.
- Multi-instance failover (leader election) is built in.
- Per-cause action policy (log / auto-unstuck / abort / etc.) is
  configurable per-user in one file, opt-in.
- Manual `POST /unstuck/:sid` route already exists for the UI buttons.

Cons:
- Adds a runtime dep on the plugin being loaded. If the user removes
  the plugin from opencode.json, openportal loses the rich verdict
  vocabulary (falls back per step 6).
- Cross-machine: the leader is at `127.0.0.1:4098` of WHICHEVER host
  is running openportal. If a user wants stuck verdicts about a
  remote opencode-serve from openportal on a different host, the
  plugin needs to expose `0.0.0.0` (config option exists) AND
  openportal needs to know that host's address. Out of scope for the
  current single-host setup.

## 7. Reference: opencode-stuck-detector files relevant to this plan

| Path | Role |
|---|---|
| `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts` | opencode plugin entry. Leader election on `127.0.0.1:4098`, worker registration, HTTP API surface, per-cause dispatch. |
| `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/db-detector.ts` | DB-only classifier. `classify(db, sid, opencodeUrl)` is the public API. SQL CASE expression at line 284 produces the verdict; supplementary post-processing at lines 358-450 applies `no-runner` cross-check and warning promotion. |
| `~/projekty/nowaker/opencode-tools/_lib/opencode-status/index.ts` | `queryStatusAcrossProjects(url)`, `classifyRetry(state, now)`. Already used by `resumer.ts`. |
| `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/resumer.ts` | The unstucker. Per-cause recovery dispatch. openportal's banner action buttons would route through equivalent endpoints. |
| `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/thresholds.ts` | Every numeric threshold with provenance (SOURCE-DERIVED vs ARBITRARY). |
| `~/projekty/nowaker/opencode-tools/opencode-stuck-detector/README.md` | Full design doc + recovery method table per cause. |

## 8. Open questions for the user

1. **Pick the option**: Option D (consume plugin HTTP API on 127.0.0.1:4098) is the recommended path now that the plugin's been confirmed. Option B (vendor as workspace library) is the fallback if the plugin can't be loaded for some reason. Confirm?

2. **Plugin install posture**: the plugin lives at `~/projekty/nowaker/opencode-tools/opencode-stuck-detector`. To activate it on the user's machine, add it to `~/.config/opencode/opencode.json` `plugin` array. Verify the plugin loads cleanly via `opencode --pure` exclusion test before relying on it (per opencode-tools/AGENTS.md "Recovery" section, `opencode --pure` is the escape hatch for diagnosing plugin load failures).

3. **Per-cause action policy**: plugin default is ALL `"log"` (passive observer). For openportal manual UI buttons, "log" + on-demand `POST /unstuck/:sid` is the cleanest model. For background auto-recovery (e.g. `no-runner` cleanup on its own), the user opts in per-cause. Does the user want any cause set to `"unstuck"` by default, or all manual?

4. **`retry-overdue` auto-bump**: opencode's retry runner sometimes wedges on attempt 11+ with `next < now`. The plugin's HTTP API doesn't yet have a dedicated `bump-overdue` action (the resumer's `--auto-bump-overdue` flag is CLI-only). If the user wants this from openportal, the plugin needs a new dispatch handler. Worth the addition?

5. **Fallback when plugin is down**: when `127.0.0.1:4098` is unreachable (plugin not loaded, leader between failover), should openportal fall back to its current local `stallVerdict` heuristic (richer than nothing, but lacks rich vocabulary), or simply hide all stuck banners and surface a "Plugin not loaded" diagnostic in `/settings#diagnostics`?

6. **Cross-instance considerations**: the user runs both `opencode-serve-tailscale` and `opencode-serve-lan`. The plugin's leader election handles BOTH (whichever wins 4098 owns the canonical map across BOTH instances via the worker-registration mechanism). openportal just talks to the leader on 4098 - cross-instance routing is the plugin's problem, not openportal's. Confirm this is the desired model.
