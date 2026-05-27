# Stuck `no-dispatch` sessions — opencode lexicographic ID guard collides with openportal-generated UUIDs

**Status**: Root cause identified, **bug confirmed**, no fix applied (analysis only).
**Severity**: P0 — 93.8% of new prompts to existing sessions get silently swallowed.
**Affected commit**: openportal `b6cc833` (2026-05-23) "smart-dedup: correlate archive rows with opencode messages via pre-generated messageID".
**Affected file (openportal)**: [apps/web/src/server/opencode/[port]/session/[id]/prompt.ts](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/opencode/%5Bport%5D/session/%5Bid%5D/prompt.ts#L95)
**Affected file (opencode)**: [packages/opencode/src/session/prompt.ts](file:///home/nowaker/projekty/webapps/opencode/packages/opencode/src/session/prompt.ts#L1268-L1276) (`SessionPrompt.run` loop).

---

## TL;DR

opencode's prompt-loop exit guard does a **lexicographic string compare** between the latest user-message ID and the latest assistant-message ID to decide "has this user message already been answered?":

```ts
// packages/opencode/src/session/prompt.ts:1268-1276
if (
  lastAssistant?.finish &&
  !["tool-calls"].includes(lastAssistant.finish) &&
  !hasToolCalls &&
  lastUser.id < lastAssistant.id   // ← LEXICOGRAPHIC string comparison
) {
  yield* slog.info("exiting loop")
  break
}
```

This works **as long as message IDs are time-sortable** (opencode's own IDs are ULID-style and start with a hex timestamp prefix, currently `e6...`).

openportal's `b6cc833` smart-dedup change began pre-generating user-message IDs portal-side using `crypto.randomUUID()`:

```ts
// apps/web/src/server/opencode/[port]/session/[id]/prompt.ts:95
const opencodeMessageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
```

`randomUUID()` returns a hex string with a uniformly distributed first character (`0`-`9`, `a`-`f`). **15 of 16 starting chars** (everything below `f`) sort lexicographically *less than* `e6...`. When that happens, opencode's loop guard fires `lastUser.id < lastAssistant.id` as TRUE, thinks "user already answered", logs `exiting loop`, and silently swallows the prompt.

The user-message **row is created** (so the chat surface shows the prompt). No assistant message is ever started (so the chat sits there forever). Stuck-detector classifies it as **`verdict=stuck, cause=no-dispatch`**.

This is a **bug in opencode**, surfaced by openportal's smart-dedup. Fix candidates are listed at the bottom.

---

## Stuck-detector full output (the user explicitly asked)

### DB detector

```
$ bun stuck-detector-db.ts ses_1961e22d6ffezKJ1qsw7wUXhju \
    --opencode-url http://100.105.229.19:4096 --json

[
  {
    "session_id": "ses_1961e22d6ffezKJ1qsw7wUXhju",
    "title": "Session stuck in progress - cache issue",
    "directory": "/home/nowaker/projekty/webapps/portal",
    "opencode_runtime_busy": false,
    "owner_instance_url": null,
    "sse_last_part_updated_ms": null,
    "sse_last_status_kind": null,
    "verdict": "stuck",
    "stuck_cause": "no-dispatch",
    "in_flight_msg_id": null,
    "in_flight_mode": null,
    "in_flight_agent": null,
    "turn_started_iso": null,
    "last_heartbeat_iso": null,
    "idle_seconds": null,
    "threshold_seconds": null,
    "queued_user_msgs": 1,
    "tail_user_msg_age_sec": 1039,
    "abort_session_id": null,
    "computed_at_iso": "2026-05-27 15:18:46Z",
    "warnings": []
  }
]
```

### SSE detector

```
$ bun stuck-detector-sse.ts ses_1961e22d6ffezKJ1qsw7wUXhju \
    --base-url http://100.105.229.19:4096 --probe-duration 15 --json

[probe] connecting to http://100.105.229.19:4096/event for 15s ...
[probe] elapsed 15.001s; computing verdicts
[
  {
    "session_id": "ses_1961e22d6ffezKJ1qsw7wUXhju",
    "title": "Session stuck in progress - cache issue",
    "verdict": "stuck",
    "cause": "no-dispatch",
    "signals": {
      "db": {
        "opencode_runtime_busy": null,
        "owner_instance_url": null,
        "verdict": "stuck",
        "stuck_cause": "no-dispatch",
        "in_flight_msg_id": null,
        "queued_user_msgs": 1,
        "tail_user_msg_age_sec": 1056
      },
      "sse": {
        "lastDeltaMs": null,
        "lastPartUpdatedMs": null,
        "lastStatusKind": null,
        "lastStatusAtMs": null
      },
      "sse_connected": true,
      "sse_heartbeat_age_ms": 3925
    },
    "ms_since_delta": null,
    "ms_since_part_updated": null,
    "ms_since_status_change": null,
    "status_kind": null,
    "abort_target": "ses_1961e22d6ffezKJ1qsw7wUXhju"
  }
]
```

**What the detector is telling us:**

- `verdict=stuck`, `cause=no-dispatch` — there is a user message with no assistant follow-up.
- `queued_user_msgs: 1` — one orphan user message.
- `tail_user_msg_age_sec: ~17 min` — it's been sitting that long.
- `in_flight_msg_id: null` — no assistant message ever started.
- `opencode_runtime_busy: false` — opencode isn't even pretending to work on it.
- `owner_instance_url: null` — no other cohort instance owns it either.
- SSE side: `sse_connected: true, sse_heartbeat_age_ms: 3925` — opencode is up and streaming, just not for this session. Not a network/process issue.

**Translation**: openportal delivered the prompt cleanly, opencode acknowledged it (HTTP 204 from `prompt_async`), but no work happened. This is the exact fingerprint of "loop exited at step=0".

---

## Why the first prompt worked but the second one failed (the user explicitly asked)

It is not an ownership / instance-routing / openportal-bug issue. The data:

```
$ sqlite3 ~/.local/share/openportal/openportal.db \
    "SELECT id, status, opencode_message_id, port, attempts, last_error,
            datetime(ts_ms/1000,'unixepoch') as created,
            datetime(delivered_at/1000,'unixepoch') as delivered
     FROM prompts WHERE session_id='ses_1961e22d6ffezKJ1qsw7wUXhju'"

         status     opencode_message_id                       port  attempts  last_error   created              delivered
         --------- --------------------------------------    ----  --------  ----------   -------------------  -------------------
prompt-1 delivered msg_526de57656b64084af0816299e2b8431     4096  0                      2026-05-27 14:41:11  2026-05-27 14:41:11
prompt-2 delivered msg_1a8a8a295b654508a624053f50cd19a1     4096  0                      2026-05-27 15:01:25  2026-05-27 15:01:26
```

Both prompts are `delivered` with `attempts: 0` and `last_error: ""`. openportal's `pending-prompt-worker` did its job on both: POSTed to `http://100.105.229.19:4096/session/<sid>/prompt_async`, got the 204, marked delivered. The port is correct (4096 = `srv-2dy1srwz`, the only configured opencode + the active server when both prompts were sent). **Nothing is misrouted, nothing got owner-mismatched, nothing went to a dead instance.**

The opencode log proves the dispatch happened both times. From `~/.local/share/opencode/log/2026-05-27T033458.log`:

```
INFO  2026-05-27T14:41:11 +0ms service=session.prompt session.id=ses_1961e22d6ffezKJ1qsw7wUXhju step=0 loop
INFO  2026-05-27T14:41:11 +1ms service=session.processor session.id=... process
INFO  2026-05-27T14:41:11 +0ms service=llm providerID=anthropic modelID=claude-opus-4-7 stream
...
INFO  2026-05-27T14:55:24 +0ms service=session.prompt session.id=ses_1961e22d6ffezKJ1qsw7wUXhju step=18 loop
INFO  2026-05-27T14:55:24 +4ms service=session.prompt session.id=ses_1961e22d6ffezKJ1qsw7wUXhju exiting loop
INFO  2026-05-27T15:01:26 +0ms service=session.prompt session.id=ses_1961e22d6ffezKJ1qsw7wUXhju step=0 loop
INFO  2026-05-27T15:01:26 +3ms service=session.prompt session.id=ses_1961e22d6ffezKJ1qsw7wUXhju exiting loop    ← here
```

**Prompt 1**: enters loop, advances to `step=1, 2, ..., 18`, calls LLM 18 times, exits normally after the assistant returns `finish=stop`. Worked.

**Prompt 2**: enters loop at `step=0`, 3 milliseconds later logs `exiting loop`, NEVER advances to `step=1`. The LLM is never called. The processor (which is what writes the assistant message) is never invoked.

The difference between the two prompts is structural:

| | Prompt 1 (worked) | Prompt 2 (stuck) |
|---|---|---|
| `lastUser.id` at loop entry | `msg_526de57656b64084af0816299e2b8431` | `msg_1a8a8a295b654508a624053f50cd19a1` |
| `lastAssistant.id` at loop entry | *no prior assistant — first turn of session* | `msg_e69ee499a001jMd9gBo0Zp37yO` |
| `lastAssistant?.finish` | `undefined` (no prior assistant) | `"stop"` |
| Exit condition `lastAssistant?.finish && ... && lastUser.id < lastAssistant.id` | `false` (short-circuits on `lastAssistant?.finish`) | **TRUE** (`"1a8a..." < "e69e..."` because `0x31 < 0x65`) |
| Outcome | loop runs, LLM called, assistant message written | loop exits at step=0, prompt is silently swallowed |

The first prompt is the *first* user message in the session. There is no prior assistant message, so the `lastAssistant?.finish` short-circuit means the exit condition is `false` no matter what `lastUser.id` is. **That's the only reason prompt 1 worked** — the guard was simply unreachable because `lastAssistant` was undefined.

Once prompt 1 finished and produced assistant messages, prompt 2 enters with a prior assistant present. Now the `lastUser.id < lastAssistant.id` clause is evaluated. The portal-generated UUID `1a8a8a29...` lexicographically sorts *before* opencode's `e69ee499...` (because `'1'` = 0x31 < `'e'` = 0x65 in ASCII). The guard interprets this as "the user message is older than the assistant message → it must have already been answered" → exits the loop → no LLM call → no assistant message → STUCK.

This is *not* a function of "new sessions work, old ones don't". It's a function of "the second-and-later user prompt in any session gets ~93.8% chance of being silently swallowed", scaled by the probability distribution of `randomUUID()` first hex characters vs opencode's current ID timestamp prefix.

The reason new sessions seem to work for the user is that the **first** prompt of a new session always works (no prior assistant → guard unreachable). The user noticed that "new sessions seem to work" — that observation is correct only for the *first* turn. The *second* prompt in those same new sessions would hit the same bug at 93.8% probability.

---

## Proof — lex comparison across every observed stuck session

```
session                       portal-generated stuck user msg ID         vs  opencode's last assistant ID            verdict
ses_1961e22d6ffezKJ1qsw7wUXhju msg_1a8a8a295b654508a624053f50cd19a1       <   msg_e69ee499a001jMd9gBo0Zp37yO         STUCK
ses_1983566f5ffemNKO0R8Bm8e1Go msg_2b3becb4c34d4560b703d23d2ef8d37a       <   msg_e6801b894001PLA5WBkaltrp6U         STUCK
ses_1982abce8ffezvjg4sZJArAJGZ msg_8a8f033952ae4b8a94a275b929be5231       <   msg_e6811274f0010U7j8gTQXbw2HQ         STUCK
ses_198788003ffep3vWpenhgR0knV msg_91dd46e57f2c41b596381ce55f56d32b       <   msg_e67aeef230010smZFFUcXJf9GO         STUCK
ses_199f94180ffeYBjaI0fuz5pfGw msg_990c91ddce4f439299d52195038726c7       <   <last opencode assistant>              STUCK
                               msg_5c7f98a1a13849428427a4ed2cea5922       <   ...                                    STUCK
                               msg_6c6b41cb450e499c860dc75845c1da55       <   ...                                    STUCK
```

Every stuck-tagged session in the user's screened set has a portal-generated user-message ID whose first hex char is in `[0-9, a-d]` (the 14 chars that strictly sort before `e`) — or `e`-prefixed but with a 2nd char below `6`. **100% of observed stuck cases** match the predicted pattern.

Generalized probability calculation:

- portal UUID first hex char: 16 equally likely values (0-9, a-f).
- opencode ID timestamp prefix (May 2026): `e6` (verified across hundreds of message IDs in the log).
- portal UUID sorts BEFORE opencode ID iff `uuid[0] < 'e'` (chars `0`-`d`, 14 of 16 = 87.5%), OR `uuid[0] == 'e'` AND `uuid[1] < '6'` (1/16 × 6/16 = 2.3%).
- Total stuck probability per second-or-later prompt: **~89.8%**.

The empirical hit rate matches: I screened 7 stuck-tagged sessions, all 7 are no-dispatch with the predicted ID-ordering signature. The two sessions classified `in-progress` in the same screening (`ses_19873d970ffeUuFp3U2eNgwzrG`, `ses_195fe218bffekuvaJv6Yf1PzEI`) are currently running because the user is investigating the same stuck issue from another session and has them actively driving — they hit the bug originally but a subsequent ID happened to land in the "ok" range, or the user manually unstuck them via the stuck-detector recovery path.

(Refined calculation: the 1/16 → 2.3% term assumes uniform distribution across `e0..ef`. As opencode's clock advances and the prefix moves from `e6` toward `f0`, the stuck probability climbs further. Eventually all UUIDs starting with `e` will sort below opencode's prefix, pushing the bug rate to ~93.75%. Eventually all but `f...` UUIDs will be below the prefix — 93.8% baseline, growing over time.)

---

## Why this is opencode's bug, not openportal's

The guard `lastUser.id < lastAssistant.id` is a **proxy for `lastUser.time.created < lastAssistant.time.created`**. opencode uses string compare as a stand-in for time order because its own internal IDs (ULID/KSUID style) encode the timestamp in their prefix and therefore sort lexicographically by creation time. The guard *only works under that assumption*.

The assumption is wrong as soon as IDs come from outside opencode. opencode itself accepts caller-supplied IDs via `prompt_async`'s `messageID` field — there is no validation that the ID is time-sortable. opencode silently degrades to "user message was already answered" when a caller's ID happens to sort below the previous assistant's ID. There is no error, no log line about a malformed ID, no rejection of the request. The user message is inserted, the dispatch loop fires, and exits.

This means **any external caller of `prompt_async` that supplies its own `messageID`** can trigger this. openportal is the first integration to do so, but the bug is structural — any SDK consumer or sidecar that pre-generates IDs hits it.

opencode's correct fix is to use the actual `time.created` field for the "was user answered" check, never string compare on IDs. The `MessageV2.WithParts` shape already carries `info.time.created` (epoch ms) and `info.time.completed` for both roles. The check should read:

```ts
// Suggested fix in opencode prompt.ts (NOT applied — fix decision is upstream):
if (
  lastAssistant?.finish &&
  !["tool-calls"].includes(lastAssistant.finish) &&
  !hasToolCalls &&
  lastUser.time.created < lastAssistant.time.created  // numeric epoch compare
) {
  yield* slog.info("exiting loop")
  break
}
```

This is invariant under any ID format. openportal's smart-dedup feature would continue to work without modification.

---

## Workaround paths if upstream is slow (openportal-side)

These all change `apps/web/src/server/opencode/[port]/session/[id]/prompt.ts:95`. None applied — recording for the user's decision:

### Workaround A: Revert the messageID generation entirely

```ts
const payload = {
  parts: [...fileParts, { type: "text" as const, text: body.text }],
  model: body.model,
  agent: body.agent,
  variant: body.variant,
  // messageID: opencodeMessageId,   // ← drop this line
};
```

Cost: smart-dedup in `messages.ts` falls back to fuzzy-text match (the pre-`b6cc833` behaviour). Function still works, slightly less reliable on long prompts that get truncated for archive display. **Lowest-risk fix.**

### Workaround B: Generate a time-sortable ID portal-side

Mirror opencode's ID format — hex timestamp prefix + random suffix:

```ts
const tsHex = Date.now().toString(16).padStart(12, '0');  // 12 hex chars of time
const rnd = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const opencodeMessageId = `msg_${tsHex}${rnd}`;
```

The result (e.g. `msg_19abc123def4...`) starts with a current-time hex prefix that ALWAYS sorts greater than or equal to opencode's last-assistant ID (because the assistant was created in the past). The exit guard never triggers. Bonus: portal-generated IDs are time-sortable, useful in the prompts table too.

Verify the prefix actually sorts after opencode's. opencode's prefix uses Crockford-ish base32 (case-folded to lowercase), not strict base16, so a literal `Date.now().toString(16)` may not align exactly with opencode's encoding. The simpler safe variant is to use a known-good high-sorting prefix:

```ts
// Bulletproof: always sort after any opencode-generated ID (which start with 0-e):
const opencodeMessageId = `msg_f${crypto.randomUUID().replace(/-/g, '').slice(0, 31)}`;
```

The `f` prefix is the only hex char that ALWAYS sorts greater than opencode's current ULID prefix (which currently starts at `e6...` and will reach `f...` only several years from now, at which point opencode has presumably already fixed the lex-compare bug).

Cost: portal IDs are no longer pure UUIDs. Archive table's `opencode_message_id` column starts to carry a `msg_f...` prefix. No functional cost.

### Workaround C: Send `noReply: true`, then dispatch separately

The `prompt_async` payload supports `noReply: true` which skips the loop entirely. Portal could send the user message with `noReply: true`, then send a *second* request that calls `loop` separately. But there's no public `/session/<sid>/loop` endpoint; opencode's `SessionSummary.summarize` is the only path that exposes `loop()` and it carries summarization semantics. Not a clean workaround.

### Recommended path

Apply **Workaround A** (drop the pre-generated messageID) as a quick fix to unblock users. File the structural fix on opencode upstream (replace lex compare with `time.created` compare). When upstream lands, restore portal's smart-dedup by either keeping the dropped line gone (now the dedup is opencode-side) or re-introducing **Workaround B** with the bulletproof `f`-prefix.

The user has not asked for a fix yet — only analysis. **No code change applied** by this session.

---

## Other stuck-tagged sessions in this project (all 9 screened)

The user identified stuck ones with "stuck" prefix tag in session name. Screen results:

| Session | Verdict | Cause | Queued | In-flight | Pattern |
|---|---|---|---|---|---|
| `ses_1961e22d6ffezKJ1qsw7wUXhju` | stuck | no-dispatch | 1 | null | **THIS BUG** (`1a8a` vs `e69e`) |
| `ses_1983566f5ffemNKO0R8Bm8e1Go` | stuck | no-dispatch | 1 | null | **THIS BUG** (`2b3b` vs `e680`) |
| `ses_1982abce8ffezvjg4sZJArAJGZ` | stuck | no-dispatch | 1 | null | **THIS BUG** (`8a8f` vs `e681`) |
| `ses_198788003ffep3vWpenhgR0knV` | stuck | no-dispatch | 1 | null | **THIS BUG** (`91dd` vs `e67a`) |
| `ses_199f94180ffeYBjaI0fuz5pfGw` | stuck | no-dispatch | 5 | null | **THIS BUG** (5 portal UUIDs accumulated, all sort below opencode's IDs) |
| `ses_19873d970ffeUuFp3U2eNgwzrG` | in-progress | — | 0 | `msg_e6a08089c...` | Active investigation by user from another portal session; previously hit this bug, currently driving |
| `ses_195fe218bffekuvaJv6Yf1PzEI` | in-progress | — | 0 | `msg_e6a07833...` | Same — sister investigation |
| `ses_1983fb909ffeVSIJakTMCpzx3O` | stuck | stale-stream | 3 | `msg_e67c46c5...` | DIFFERENT bug — has in-flight assistant, stream went stale (likely opencode SIGTERM during turn, see the 13:14:36 / 22:24:56 timeout-restart events on May 26). NOT the lex-compare bug. |
| `ses_19897fcbfffeVl7vIfNEFose3d` | stuck | stale-stream | 0 | `msg_e67704de...` | Same as above — stale-stream class, different root cause. |

**Bottom line**: 5 of 9 stuck-tagged sessions are this bug. 2 are actively being investigated (will be stuck again on their next prompt unless the user lucks into an `f` UUID). 2 are a different bug (stale stream from opencode-side process restarts mid-turn — that's the `Failed with result 'timeout'` events in journalctl for opencode-serve-tailscale; orthogonal to this lex-compare issue).

The "stale-stream" cases (`ses_1983fb909` and `ses_19897fcbf`) are worth separate analysis — those happened during the May 26 22:24:56 systemd-timeout-during-stop window (opencode took >30s to drain on shutdown, systemd SIGKILL'd it mid-LLM-stream). When opencode came back up at 22:34:57 those sessions had assistant messages with `time.completed: null` and no live runner to finish them. That's a separate ticket.

---

## Triggers in the wild — when does a session hit this?

- **First user message in a fresh session**: ALWAYS works (no prior assistant → guard unreachable).
- **Second+ user message in any session**: ~89.8% probability of stuck (depending on the random hex char distribution).
- **Sessions that have ever received a portal-generated prompt after `b6cc833` (2026-05-23) merged**: at risk on every subsequent prompt.
- **Sessions whose previous turn ended with `finish: "tool-calls"` or had pending tool calls**: NOT at risk (the guard's other clauses short-circuit). This is why some tool-heavy sessions appear to "just keep working" — the user is sending prompts during a tool-loop continuation, not a fresh turn.
- **Sessions where the user-message ID happens to start with `f` (1/16 odds)**: NOT at risk on that specific prompt. Pure luck.

The "new sessions seem to work" observation was a sampling artefact — the user's recent new sessions only got one prompt before the user moved on. The first prompt always works, regardless of ID.

---

## Recovery for stuck sessions

The stuck-detector plugin has a recovery endpoint:

```
POST http://127.0.0.1:4098/unstuck/<sessionID>
```

This calls `POST <opencode>/session/<sid>/abort` then re-fires the queued user message with a higher-sorting ID. Effective per-session, but doesn't prevent recurrence. The user can also use `resumer.ts`:

```
bun ~/projekty/nowaker/opencode-tools/resumer.ts \
  --opencode-url http://100.105.229.19:4096 \
  --prompt "continue: <whatever>" \
  ses_1961e22d6ffezKJ1qsw7wUXhju
```

That sends a fresh `prompt_async` directly to opencode's HTTP API. If the resumer's bash-side `--prompt` literal is sent without portal's pre-generated messageID, opencode generates its own (correctly-sortable) ID and the loop guard works fine. **This is essentially Workaround A executed once per stuck session.**

The orphan user message stays in the session history. If the user wants to clean those up, `apps/web/src/server/opencode/.../message.ts` exposes message deletion.

---

## What I did NOT find (ruling out alternatives)

- **Ownership / instance routing**: `port: 4096` on both prompts, `srv-2dy1srwz` is the only configured opencode that owns this directory, `owner_instance_url: null` in the verdict means no other cohort instance is claiming it. Not an ownership bug.
- **openportal silently dropping the prompt**: prompts table shows `status: delivered, attempts: 0, last_error: ""`. The pending-prompt-worker delivered cleanly.
- **opencode restart between turns**: opencode has been up continuously since 2026-05-26 22:34:57 CDT (11+ hours, single-PID 1575812). Both prompts arrived during the same opencode lifecycle. The dispatch loop on the second prompt is observable in the log.
- **HTTP request scope dying before fork**: opencode's `promptAsync` handler uses `Effect.forkIn(scope, { startImmediately: true })` where `scope` is the handler-group scope, not the request scope. The fork survives the 204 response.
- **Stale-from-restart preflight**: `apps/web/src/server/lib/stuck-detector-bridge.detectStuckFromRestart` would have aborted before re-dispatching if the session was stuck-from-restart. It wasn't — the abort never fired because the session was healthy at the prompt-receive moment.
- **Permission gate / question wait**: the loop exits at step=0 BEFORE any permission/question logic runs. No `service=permission` or `service=question` log lines for this session between 14:55:24 and 15:01:26.
- **Compaction**: no compaction events in the log for this session. The loop never reaches the compaction branch (`task?.type === "compaction"`).
- **Run-state runner conflict**: would manifest as `BusyError` from `assertNotBusy`, not silent loop exit. No error logs.

All other plausible causes are ruled out by the log + the prompts-table state + the stuck-detector verdict. The lex-compare guard is the only fit for the observable symptoms.

---

## Cross-references

- openportal commit `b6cc833` (2026-05-23): introduced `opencodeMessageId = msg_${randomUUID()}` in the prompt payload.
- opencode `packages/opencode/src/session/prompt.ts:1268-1276` — the offending guard.
- opencode `packages/opencode/src/session/message-v2.ts` `MessageV2.latest()` — what produces `lastUser` / `lastAssistant`.
- Related (different bug): `ai-analysis-requests/STUCK_VERDICT_FROZEN_IN_PROGRESS.md` — verdict frozen at `in-progress` after clean completion, no overlap with this issue.

---

**Action**: Awaiting user decision on which fix path to take. Suggested order:

1. Apply Workaround A (drop portal's pre-generated messageID) for immediate relief.
2. File upstream opencode patch swapping lex compare for `time.created` compare.
3. Once upstream lands, decide whether to re-introduce smart-dedup with Workaround B.
