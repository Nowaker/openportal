---
status: DONE
session: ses_198124cb5ffeaWVOzvQ1tcjCMY
queued_at: 2026-05-27T00:34:52-05:00
legacy_number: 92
commits:
  attributed:
    - 2f181c36ba08
  on_main:
    - 2f181c36ba08
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Stall verdict: "Server is idle - generation never started" must not fire when a final AI response is visible

User prompt (verbatim):

> AI responses in chat log have:
> [icons] 5/26, 22:16
> Or
> [icons] 22:16
>
> Let's also add, in next line, agent name, model name, thinking effort, and total total processing time (nice formatting eg 5m, max two units of time, eg 5m 23s, but 5h 5m not seconds any more, or 1d 5h, and not minutes etc), if this is the final answer from the AI. one that is considered the end.
>
> And while there look at this thing. When a final Ai response is in the output, and nothing is queued afterwards, portal sometimes shows nonsense: Server is idle - prompt accepted but generation never started.
> Resubmit
>
> There's a final response in the chat. The Ai is done. Stuck detector doesn't complain. So Why show this?! Fix this.Git tree, merge after done, deploy, push

Design notes:

- Bug surface: the warning banner "Server is idle - prompt accepted but generation never started. Resubmit" rendered at `apps/web/src/routes/_app/session/$id.tsx` around line 5573 (gated by `stallVerdict === "no-dispatch"`). User reported it firing on idle sessions where the AI has clearly finished — final assistant response present in the chat, stuck-detector not flagging anything, opencode reports idle.
- Root cause in the `stallVerdict` useMemo (around lines 3861-3872 pre-fix):
  - `isAssistantBusy` returns `true` whenever the last message is an assistant message WITHOUT `time.completed`. This is correct for the in-flight / streaming case but ALSO matches a stale-cache case where the response landed but `time.completed` didn't propagate through the messages-cache merge (LRU + 30s SQLite throttle window per AGENTS.md "Caching proxy" section, plus the new messages-refresh path from #86).
  - When `isAssistantBusy=true` + `isServerBusy=false` + age >= 30s, the verdict returned `"no-dispatch"` — which the banner reads as "generation never started". With a visible final response above, that's nonsense.
- Fix: before returning `"no-dispatch"` (inside the `if (!isServerBusy)` branch of `stallVerdict`), check the LAST message's role. If it is `"assistant"`, generation DID dispatch — the `time.completed` flag is just lagging. Return `null` (no banner) instead of `"no-dispatch"`.
- The Reconciling pill on the message itself already covers the rare stale-snapshot case for operators who care; the page-level banner is reserved for true dispatch failures (last message is a user prompt with no assistant reply).
- The `"stuck-busy"` branch is untouched. It only fires when `isServerBusy=true` and age >= 5min — a different scenario (server claims working, no progress) that's still real.
- `messages` added to the useMemo dependency array so the verdict re-evaluates when the message list changes.
- Verified via playwright on the running prod build: `idleBannerCount: 0` across the page, zero matches for "Server is idle" text. Historical sessions with multiple completed assistant turns no longer trip the banner.
- Files: `apps/web/src/routes/_app/session/$id.tsx` (stallVerdict useMemo only).
- Code shipped together with #91 in commit `2f181c3`.
