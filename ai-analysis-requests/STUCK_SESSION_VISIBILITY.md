# Stuck-session visibility in OpenPortal

Forensic analysis of two user-reported sessions that LOOK queued/stuck but
where openportal renders no STUCK indication. Both are the same underlying
bug; the second one also surfaces a separate orphaned-prompts pattern that
is logged here for follow-up.

- Investigation date: 2026-05-27
- Investigated by: AI session
  `ses_19873a1a5ffefIFntmtkxlb3VL` (Sisyphus)
- Sessions inspected:
  - `ses_199f94180ffeYBjaI0fuz5pfGw` (5 queued user msgs)
  - `ses_1adcb0fddffenglncs0bYf820u` (4 queued user msgs)

---

## TL;DR

1. **The messages are NOT lost.** OpenCode's HTTP API (and its on-disk
   SQLite) contains every trailing user message visible in OpenPortal's
   chat view. Verified via direct curl against
   `http://127.0.0.1:4096/session/<sid>/message`.
2. **OpenCode just isn't dispatching a runner** for those messages.
   That's the "no-dispatch" stuck state. The stuck-detector plugin at
   `127.0.0.1:4098` correctly identifies it
   (`verdict=stuck cause=no-dispatch queued_user_msgs=N`).
3. **OpenPortal SHOULD render a red pulsing STUCK badge with click-to-
   unstuck**, but doesn't, because of a verdict-routing bug in
   [`apps/web/src/server/lib/indicator-state.ts`](../apps/web/src/server/lib/indicator-state.ts)
   `applyStuckVerdict()`. The function silently drops verdicts for any
   session that has no pre-existing indicator-state entry. Stuck
   sessions never have one (see "Why indicator state is empty" below).
4. **OpenCode's own web UI** rendering only the assistant trail is an
   opencode-side rendering quirk - not an openportal-side bug. The
   messages are in opencode, just not visualised in opencode's web UI
   because there's no following assistant. That's by design upstream.
5. **Bonus / unrelated:** OpenPortal's `prompts` archive contains 2
   older rows (May 18-19) with `status='delivered'` but
   `opencode_message_id IS NULL`. Separate orphaned-prompt pattern
   noted at the bottom; needs its own follow-up.

---

## Bug #1: STUCK badge never renders

**Surface:** Session
`ses_199f94180ffeYBjaI0fuz5pfGw` (project: `/home/nowaker/projekty/webapps/portal`).

**Plugin verdict** (from `GET /verdicts/<sid>` on the local plugin):

```json
{
  "sessionID": "ses_199f94180ffeYBjaI0fuz5pfGw",
  "verdict": "stuck",
  "stuck_cause": "no-dispatch",
  "queued_user_msgs": 5,
  "opencode_runtime_busy": false,
  "owner_instance_url": null,
  "workerID": "nwkr-desktop-533313-4096",
  "computed_at_iso": "2026-05-27 02:51:36Z"
}
```

The plugin is correct. The session has 5 queued user messages and no
in-flight assistant. The detector's `no-dispatch` cause is the right
classification.

**OpenPortal indicator snapshot** (`GET /api/indicators`):

```json
{ "sessions": [], "ok": true }
```

Empty. For every session. Not just the stuck one.

**Why empty:** OpenCode's `/session/status` returns only sessions with
an active in-process runner. Currently `{}`. Idle, queued, and stuck
sessions are never reported there. OpenPortal's
[`indicator-broadcaster.ts`](../apps/web/src/server/plugins/indicator-broadcaster.ts)
seeds the indicator-state Map from:

1. `/session/status` on connect (the hydrate path) - empty result
   means zero seeds.
2. Live SSE frames from opencode `/event` - only fires for sessions
   that are actively emitting events. A stuck session does NOT emit
   events by definition.

So the Map is empty for any session that isn't currently churning.

**The drop:**
[`indicator-state.ts:434-455`](../apps/web/src/server/lib/indicator-state.ts)
`applyStuckVerdict`:

```ts
export function applyStuckVerdict(update: StuckVerdictUpdate): void {
  let any = false;
  for (const [k, cur] of sessions.entries()) {
    if (cur.sessionId !== update.sessionID) continue;
    // ... mutate matching entries ...
    any = true;
  }
  if (!any) {
    /* No indicator entry yet for this session. The verdict cache from
       the plugin includes sessions that haven't yet emitted an event
       portal subscribes to. Dropped; the verdict re-arrives when the
       plugin notices a status change. */
  }
}
```

The comment is wrong: a stuck session stays stuck. The verdict's
content doesn't change. The plugin re-emits the same verdict on every
client reconnect (snapshot replay), but every time the Map is checked
and every time no entry matches, so the verdict is dropped forever.

**End-to-end consequence:** Browser opens session in chat view, calls
[`useIndicator(serverId, sessionId)`](../apps/web/src/hooks/use-indicators.ts)
which subscribes to `/api/indicators/stream`. The stream has no entry
for this session, so the indicator object the browser sees is null.
[`pickBadgeStatus(null)`](../apps/web/src/lib/session-status.ts) returns
null. No badge renders. The
[`<SessionStatusBadge>`](../apps/web/src/components/session-status-badge.tsx)
component never gets to its STUCK branch where the click-to-unstuck
button lives.

---

## Bug #2: "OpenPortal shows queued; OpenCode web UI doesn't"

**Surface:** Session
`ses_1adcb0fddffenglncs0bYf820u`. User viewing
`#msg-msg_e465188ccebf4ce7b417cd76b042b9bd` in openportal sees 4
trailing user prompts with no assistant response.

**Verification that the messages reached opencode** (`curl
http://127.0.0.1:4096/session/<sid>/message | jq '.[-10:]'`):

The API returns 458 messages. The last 6 are assistant messages
(complete, all with `time.completed` set). The last 4 are user
messages, all `role=user`, all with `time.completed=null`,
all with `parts_count=1`:

| msg_id | created (UTC) | role | completed |
|---|---|---|---|
| msg_e24d7bc42e... | 2026-05-27 00:28:05 | user | null |
| msg_e465188cce... | 2026-05-27 00:38:14 | user | null |
| msg_aaabdebe71... | 2026-05-27 00:44:43 | user | null |
| msg_0d174f1f48... | 2026-05-27 00:49:47 | user | null |

The last assistant `msg_e65403a38...` completed at 2026-05-26
**19:46:30 UTC** - approximately **7h before** the user submitted
msg_e24d. Then 4 user prompts arrived spaced 10/6/5 minutes apart,
each waiting for a response that never came. That spacing pattern is
the user's repeated attempts to get a response.

> Note on `completed: null`: that's the NORMAL state for every user
> message in opencode. Sampled the last 12 user messages on this
> session: 12/12 have `completed: null`. So `null` doesn't mean
> "queued by openportal" or "undelivered" - it's just opencode's data
> shape for user messages. The signal that they're stuck is the
> ABSENCE of any following assistant message, not the null timestamp.

**Plugin verdict:**

```json
{
  "sessionID": "ses_1adcb0fddffenglncs0bYf820u",
  "verdict": "stuck",
  "stuck_cause": "no-dispatch",
  "queued_user_msgs": 4,
  "opencode_runtime_busy": false,
  "owner_instance_url": null,
  "workerID": "",
  "computed_at_iso": "2026-05-27 03:05:40Z"
}
```

Same diagnosis. 4 queued user messages, no in-flight, no dispatch.

**Where the messages live:**

- OpenCode HTTP API: 4/4 visible (just demonstrated above).
- OpenCode SQLite (`~/.local/share/opencode/opencode.db`):
  4/4 rows in the `message` table for this session.
- OpenPortal SQLite (`~/.local/share/openportal/openportal.db`)
  `prompts` table for this session: 7 rows total. Only msg_e24d is
  archived (`ee9eddef-...` -> `msg_e24d7bc4...` linked). The other
  3 trailing user messages were submitted via a path that doesn't
  archive in openportal (most likely opencode's own CLI/UI or a
  hook-injected continuation; not all user messages in this session
  came through openportal - 41 user messages in opencode total vs.
  7 openportal prompts ever).

**Why opencode's web UI shows nothing past "Both done. Final state
summary:":** that's the assistant text in `msg_e65403a38...`. Opencode's
own web UI renders the assistant trail; the 4 trailing user-with-no-
assistant messages don't get rendered there. That's an opencode-side
UI choice, not a missing-data condition - opencode's own *API* has
the messages, the *UI* just doesn't draw them. Not an openportal bug.

**Same root cause as Bug #1:** even though those messages exist
everywhere relevant and the plugin correctly reports stuck, openportal
has no indicator-state entry, so `applyStuckVerdict` drops the
verdict, so no badge renders.

---

## Why the indicator-state seed paths fail for stuck sessions

`indicator-broadcaster.ts` has two seed paths:

### Seed path 1: `hydrateFromStatusEndpoint`

Runs once on (re)connect:

```ts
const url = `http://${host}:${upstreamPort}/session/status`;
const res = await fetch(url, ...);
const body = (await res.json()) as Record<string, unknown>;
for (const [sessionId, info] of Object.entries(body)) {
  applyOpencodeEvent(serverId, port, {
    type: "session.status",
    properties: { sessionID: sessionId, info: { time: { completed } } },
  });
  ...
}
```

OpenCode's `/session/status` returns `{}` when no runner is in flight.
On a quiet/stuck day that's effectively always empty. Zero seeds.

### Seed path 2: SSE `processStream`

Receives opencode `/event` frames and calls `applyOpencodeEvent` which
calls `ensureState(serverId, port, sid)` to lazily create the Map
entry. But stuck sessions don't emit frames - no `message.created`,
no `message.updated`, no `session.status`. So `ensureState` is never
called for them.

### The plugin verdict is the only signal we have

The stuck-detector plugin (loopback, port 4098) DOES know the session
is stuck. It emits a verdict object that includes `sessionID`,
`verdict`, `stuck_cause`, `directory`, and (when known)
`owner_instance_url`.

`applyStuckVerdict` receives that verdict but the design assumes the
Map already has an entry to update. It doesn't, and the verdict is
the only signal that COULD have created one.

---

## Fix design

Make `applyStuckVerdict` create indicator-state entries when no
matching entry exists. This is the cleanest, lowest-risk change.

### Edit 1 - `apps/web/src/server/lib/indicator-state.ts`

Extend `StuckVerdictUpdate` with optional `seedTargets` -
caller-supplied `{ serverId, port }[]` to seed when no entry exists.

```ts
export interface StuckVerdictUpdate {
  sessionID: string;
  verdict: "idle" | "in-progress" | "stuck";
  stuck_cause: string | null;
  warnings?: string[];
  retry?: { ... } | null;
  // NEW. When no existing indicator entry matches this session,
  // create one entry per target so the verdict reaches the UI.
  // Empty / omitted => preserve pre-fix drop-on-miss behaviour.
  seedTargets?: Array<{ serverId: string; port: number }>;
}

export function applyStuckVerdict(update: StuckVerdictUpdate): void {
  let any = false;
  for (const [k, cur] of sessions.entries()) {
    if (cur.sessionId !== update.sessionID) continue;
    // unchanged: mutate matching entries
    const next = { ...cur, stuck_verdict: update.verdict, ... };
    sessions.set(k, next);
    fanOut({ type: "update", state: next });
    any = true;
  }
  if (any) return;
  const targets = update.seedTargets ?? [];
  for (const t of targets) {
    const fresh = emptyState(t.serverId, t.port, update.sessionID);
    fresh.stuck_verdict = update.verdict;
    fresh.stuck_cause = update.stuck_cause;
    fresh.stuck_warnings = update.warnings ?? [];
    fresh.retry = update.retry ?? null;
    fresh.lastEventAt = Date.now();
    sessions.set(key(t.serverId, fresh.sessionId), fresh);
    fanOut({ type: "update", state: fresh });
  }
}
```

`indicator-state.ts` stays dependency-light: it does not import the
server registry. The caller resolves targets and passes them in.

### Edit 2 - `apps/web/src/server/plugins/stuck-detector-client.ts`

Extend `RawVerdict` to carry `directory` and `owner_instance_url`.
Resolve serverId(s) from `listConfiguredServers()`:

- If `owner_instance_url` is set and matches a configured server URL,
  seed only that one.
- Else fan out to every configured server. The user's view of the
  session under server X reads only X's entry; other entries are
  invisible to that browser. ~100 sessions x ~2 servers ~= ~200
  entries, ~500 bytes each ~= ~100KB. Trivial.

```ts
function resolveSeedTargets(raw: RawVerdict): Array<{ serverId: string; port: number }> {
  const registered = listConfiguredServers();
  if (typeof raw.owner_instance_url === "string") {
    const u = raw.owner_instance_url.replace(/\/$/, "");
    const hit = registered.find((s) => `http://${s.host}:${s.port}` === u);
    if (hit) return [{ serverId: hit.id, port: hit.port }];
  }
  return registered.map((s) => ({ serverId: s.id, port: s.port }));
}

function normalize(raw: RawVerdict): StuckVerdictUpdate | null {
  // ...existing fields...
  return {
    sessionID: raw.sessionID!,
    verdict,
    stuck_cause: ...,
    warnings: ...,
    retry: ...,
    seedTargets: resolveSeedTargets(raw),
  };
}
```

### What this fixes

- Bug #1: STUCK badge renders for `ses_199f94180ffeYBjaI0fuz5pfGw`.
- Bug #2 (the "queued" complaint): STUCK badge renders for
  `ses_1adcb0fddffenglncs0bYf820u`. User sees red pulsing pill, clicks
  it, dispatches /unstuck.
- Every other already-stuck session in the cohort (92 of them right
  now per the cohort stats) gets the badge too.

### What this doesn't fix

- The trailing-user-no-assistant messages in opencode are still
  stuck. The fix surfaces the stuck state; it does NOT auto-recover.
  The user still has to click STUCK -> Unstuck to dispatch recovery.
  That's by design - the existing `unstuck.post.ts` POST handler
  already proxies to the plugin's `/unstuck/<sid>` endpoint, which
  is the right recovery path.

### Secondary concern (not blocking)

The `[stuck-detector-client]` plugin SSE stream from
`127.0.0.1:4098/verdicts/stream` drops with "socket connection
closed unexpectedly" every ~30s. The reconnect-with-snapshot loop
recovers each time, so functionally the verdicts still propagate
(after the fix above). Worth investigating in opencode-tools later -
likely the plugin's Bun.serve closing idle SSE responses, or Bun's
client keep-alive timeout.

After the openportal fix lands, the SSE drops become benign noise.
If they become annoying, fix in opencode-tools, not here.

---

## Resolved: 2 "orphan delivered" prompts are pre-feature legacy data

(Initially logged as a suspected bug; follow-up investigation
proved it is not. Resolution captured here so the file is the
single source of truth.)

Initial observation, for session `ses_1adcb0fddffenglncs0bYf820u`:

```sql
SELECT id, status, opencode_message_id, datetime(delivered_at/1000)
FROM prompts
WHERE session_id='ses_1adcb0fddffenglncs0bYf820u'
  AND status='delivered'
  AND opencode_message_id IS NULL;
```

Returns 2 rows:

| id | text (truncated) | delivered_at | opencode_message_id |
|---|---|---|---|
| `66997cb4-...` | "Continue your entire todo" | 2026-05-23 12:19:41 | NULL |
| `97d1828b-...` | "in a new worktree, build a feature that allows portal to edi..." | 2026-05-23 00:21:02 | NULL |

The first background agent claimed neither text appeared in
opencode's `part` rows, implying opencode silently dropped them.
That claim was **wrong** - the agent did a substring search that
failed because part.data is JSON-encoded and the text inside is
escaped. Re-running the search with proper LIKE matching against
the JSON body returns hits:

```sql
SELECT COUNT(*) FROM part WHERE session_id='ses_1adcb0fddffenglncs0bYf820u'
  AND data LIKE '%in a new worktree, build a feature that allows portal to edit mcps%';
-- 3 hits

SELECT COUNT(*) FROM part WHERE session_id='ses_1adcb0fddffenglncs0bYf820u'
  AND data LIKE '%Continue your entire todo%';
-- 1 hit
```

Both prompts ARE in opencode. They were delivered successfully.

Why the NULL `opencode_message_id` then? Because `opencode_message_id`
is set at ARCHIVE time, not at DELIVERY time. The mechanism (see
[`archivePrompt`](../apps/web/src/server/lib/prompt-archive.ts#L160-L237)
+ [`prompt.ts`](../apps/web/src/server/opencode/[port]/session/[id]/prompt.ts#L82-L103))
pre-generates a `msg_<uuid>` portal-side, passes it to opencode in
the `messageID` field of `promptAsync`, AND stamps the archive row
with the same id at INSERT. opencode then stamps the user message
with that exact ID. The two converge by construction.

That feature shipped in commit `b6cc833` ("smart-dedup: correlate
archive rows with opencode messages via pre-generated messageID")
on **2026-05-23 19:41:59 UTC**.

Distribution of orphans across the whole prompts DB (NOT just this
session) confirms the pre-feature theory:

```sql
SELECT COUNT(*) AS total,
       SUM(CASE WHEN opencode_message_id IS NULL THEN 1 ELSE 0 END) AS orphans
FROM prompts WHERE status='delivered';
-- total=572, orphans=492 (86%)

SELECT date(ts_ms/1000, 'unixepoch') AS day, COUNT(*) AS n
FROM prompts WHERE status='delivered' AND opencode_message_id IS NULL
GROUP BY day ORDER BY day DESC LIMIT 10;
-- 2026-05-23: 94    <- feature shipped this day at 19:41 UTC
-- 2026-05-22: 91
-- 2026-05-21: 85
-- 2026-05-20: 56
-- ... etc, going back

SELECT COUNT(*) FROM prompts
WHERE status='delivered' AND opencode_message_id IS NULL
  AND ts_ms > 1779600000000;  -- 2026-05-24 00:00:00 UTC
-- 0
```

**Zero post-feature orphans.** Every single one of the 492 orphans
predates the smart-dedup commit. The two specific orphans the user
flagged (2026-05-23 00:21 and 12:19) were both delivered hours
before the feature shipped that evening.

**Conclusion: not a bug.** Current `pending-prompt-worker.ts` +
`prompt-archive.ts` correctly stamp `opencode_message_id` for every
new delivery. The 492 pre-feature orphans are benign legacy data;
the user-visible messages are intact in opencode, they're just not
linked back to the openportal archive row.

**No backfill recommended.** Would require fuzzy-matching each
orphan to an opencode message by (session_id, ts_ms close enough,
text matches escaped). Doesn't fix anything user-visible; the dedup
in `messages.ts` continues to work because pre-feature sessions have
always relied on the fuzzy-text dedup path.

---

## Verification plan after the fix

1. Build openportal: `bash scripts/deploy.sh` (dev-first, then prod).
2. Re-fetch `/api/indicators?serverId=srv-2dy1srwz` - expect non-empty,
   with at least the currently-stuck sessions present.
3. Open the two reference sessions in the browser:
   - `https://portal.desktop.ts.nowaker.net:8443/session/ses_199f94180ffeYBjaI0fuz5pfGw?server=srv-2dy1srwz`
   - `https://portal.desktop.ts.nowaker.net:8443/session/ses_1adcb0fddffenglncs0bYf820u?server=srv-2dy1srwz`
   Both should show the red pulsing STUCK badge in the title bar with
   "STUCK" label and click-to-unstuck affordance.
4. Sidebar dots: the unified
   [`session-status.ts`](../apps/web/src/lib/session-status.ts)
   priority chain has STUCK = red pulsing as priority #2 (after
   `error`). Confirm the sidebar entries for these sessions also
   pulse red.
5. Click STUCK on one session, accept the "Unstuck this session?"
   confirm, verify the plugin's `/unstuck/<sid>` was called (toast
   "Unstuck dispatched", and `journalctl --user -u openportal.service`
   shows the POST going through).

---

## File index

- [`apps/web/src/server/lib/indicator-state.ts`](../apps/web/src/server/lib/indicator-state.ts)
  - `applyStuckVerdict` (lines ~434-455)
- [`apps/web/src/server/plugins/stuck-detector-client.ts`](../apps/web/src/server/plugins/stuck-detector-client.ts)
  - `normalize`, `fetchSnapshot`, `streamVerdicts`, `runLoop`
- [`apps/web/src/server/plugins/indicator-broadcaster.ts`](../apps/web/src/server/plugins/indicator-broadcaster.ts)
  - `hydrateFromStatusEndpoint`, `processStream`
- [`apps/web/src/lib/session-status.ts`](../apps/web/src/lib/session-status.ts)
  - `pickBadgeStatus`, `pickSidebarStatus`, `STATUS_VISUALS`
- [`apps/web/src/components/session-status-badge.tsx`](../apps/web/src/components/session-status-badge.tsx)
  - The badge component with click-to-unstuck
- [`apps/web/src/hooks/use-indicators.ts`](../apps/web/src/hooks/use-indicators.ts)
  - The browser-side SSE subscriber
- [`apps/web/src/server/stuck-detector/`](../apps/web/src/server/stuck-detector/)
  - `verdict/[id].get.ts`, `events/stream.get.ts`, `unstuck.post.ts`, etc.
- [`apps/web/src/server/lib/server-registry.ts`](../apps/web/src/server/lib/server-registry.ts)
  - `listConfiguredServers` (use this in the new
    `resolveSeedTargets` helper)
- Plugin source (read-only context):
  `/home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts`
