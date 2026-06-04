---
status: DONE
session: ses_1982abce8ffezvjg4sZJArAJGZ
queued_at: 2026-05-27T00:08:11-05:00
legacy_number: 148
commits:
  attributed:
    - f51310a99b96
  on_main:
    - f51310a99b96
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Per-message timing indicators - step duration on intermediate + dual durations on turn-final

(Originally enqueued as #143 on feat/message-timing before main shipped #143 - composer draft persistence - and #144-#147. Bumped to #148 per AI_TODO.md collision rule.)

User prompt (verbatim):

> Create a git worktree. Develop and test there (when possible). Merge to the primary branch when done. Deploy the application and make sure it works. Push afterwards.
>
> Remember to obey project's AGENTS.md and always append to AI_TODO.md.
>
> https://portal.desktop.ts.nowaker.net/session/ses_18cd90b4effeWgohIGbJD9tVkE?server=srv-2dy1srwz#msg-msg_e7bc90dea001oVOnQVu4wnG0nR
> look at this msgid.
>
> portal reports this ai response as:
>
> > 21:07
> > Sisyphus - ultraworker · Claude Opus 4.8 · max · 33s
>
> 33s may be this single turn, but not everything that happened between user's prompt and final response.
>
> final response, as well as  should have two time indicators:
>
> agent - model - variant - single turn prompt - total time for ai messages since user's prompt
>
> in-between responses, like tool calls etc currently have:  [icons] 21:08
> should have: [icons] 23s - 21:08
> (single turn time)

Design notes:

- **Intermediate assistant messages** (completed assistants that are NOT the last assistant before the next user message): the timestamp row now renders `<step duration> - <timestamp>` (e.g. `23s - 9:35 PM`). Hover title includes a `Step duration:` prefix. Implementation in `MessageItem` via a new `stepDurationLabel` computed only when `isAssistant && !isFinalAssistant && completed > created`. The label flows into `MessagePermalinkTimestamp` via its existing `display` prop so the permalink target still anchors the whole timestamp+duration phrase.
- **Final assistant messages of a turn** (assistant with `completed > 0` AND no later assistant before the next user message / end of list): the meta line now reads `agent · model · variant · <step> · <total> total`. Tooltip distinguishes "Final step: Xs" from "Total since user prompt: Ys". `<total>` is suppressed when `totalDurationMs - stepDurationMs < 1000` to avoid `33s · 33s total` noise on single-step turns.
- **`isFinalAssistant` semantic refined** in the parent `renderMessage`: was "any completed assistant"; now "completed AND no later assistant before next user in `ctx.baseVisible`". Direct consequence: intermediate completed assistants no longer render the meta line at all (per user's "in-between responses ... should have: [icons] 23s - 21:08" spec).
- **Server-side `_turnStartTime` stamp** at `apps/web/src/server/opencode/[port]/session/[id]/messages.ts` is the source of truth for the user-prompt-start time. Each assistant message's `parentID` references the user message that started its turn; the new `stampTurnStartTimes` helper builds an id→`time.created` map across the full cached message list and stamps `_turnStartTime` on every assistant. Required because the client's smart-window loader (`use-session-messages.ts`) only ships a window of messages — the originating user message may not be present in `baseVisible`, so the server has to look it up on the full list before slicing. Stamp is idempotent and mutates the cached object directly (cache is in-process, no SQLite write side effects).
- **No new files.** Worktree at `~/projekty/webapps/portal-msg-timing` on branch `feat/message-timing`, merged into `main-nowaker` and deployed via `scripts/deploy.sh`.

Verification (worktree dev on `:5200`):

- `ses_1b2fb84d8ffe0PDiIIwYGXda9J` (2-msg session): final-of-turn meta line = `Sisyphus - Ultraworker · Claude Opus 4.7 · max · 1s` (no total, threshold-suppressed since step≈total).
- `ses_18430cadeffezfBPPuNNuMqiox` (mid-turn session): intermediate timestamps render `24s - 5/30, 10:17 PM`, `56s - 5/30, 10:17 PM`, `1m 2s - 5/30, 10:18 PM` and no meta line on intermediates (correct).
- `ses_18cd90b4effeWgohIGbJD9tVkE` (130-msg templates session): API `_turnStartTime` stamp confirmed via `curl /api/opencode/4096/session/.../messages?limit=0` for `msg_e7bf77dbd001EciBkAFF9wcLSw` → step=76.5s, total=1380.0s (≈23min).
- Pre-existing `gapCount.toLocaleString()` crash on permalink-hash navigation (commit `aa93056`) was observed but is NOT introduced by this change — it triggers any time the smart-window loader's gap UI receives an undefined `gapCount`, independent of timing display.

Follow-up: drop the ` total` suffix on the second duration on user request — the order alone makes it clear (step then total), the word added noise. Meta line now reads `agent · model · variant · <step> · <total>`. Tooltip still distinguishes "Final step" vs "Total since user prompt".
