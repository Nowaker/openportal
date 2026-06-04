---
status: DONE
session: ses_195fe218bffekuvaJv6Yf1PzEI
queued_at: 2026-05-27T10:16:09-05:00
legacy_number: 98
commits:
  attributed:
    - 4537a0d46e0f
  on_main:
    - 4537a0d46e0f
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Investigation + fix: stuck `no-dispatch` sessions — opencode prompt-loop exit guard collides with portal-generated UUIDs

User prompts (verbatim, in arrival order):

> Look at https://portal.desktop.ts.nowaker.net:8443/session/ses_1961e22d6ffezKJ1qsw7wUXhju?server=srv-2dy1srwz
> It's stuck. Why is it stuck?
> What does stuck detector say about it? Provide full output.
>
> And conceptually, why did this task complete the first prompt without an issue, but then opencode failed to pick up the next message? Does openportal submit it incorrectly somehow? Was the ownership of this subsequent prompt set to an instance that isn't running? Wtf is going on here? It's not just one session like that where subagent message is stuck. New sessions seem to work, that's why I'm submitting this one as new.
>
> Present full analysis of the problem. I need to be fully convinced you understand the actual problem. Screen other sessions in this project too. I identified stuck ones with "stuck" prefix tag in session name.

> Do B. Around the code that's doing it document why it has to stay that way. Before you do that, fire prompt async to my stuck sessions in portal project with f prefixes messages to see if this unblocks these sessions. If yes, proceed.

> wtf. DEPLOY AND FIX ALL SHIT.
> analysis was no to do anything wtf

Design notes:

- Root cause: opencode's prompt-loop exit guard at [packages/opencode/src/session/prompt.ts](file:///home/nowaker/projekty/webapps/opencode/packages/opencode/src/session/prompt.ts#L1268) line 1268-1276 string-compares `lastUser.id < lastAssistant.id` as a proxy for time ordering. The proxy works for opencode's own ULID-style IDs (timestamp prefix `e6...` in 2026) but breaks for any caller-supplied messageID with lower sort order. Portal commit `b6cc833` (smart-dedup) started feeding opencode `msg_${randomUUID()}` payloads. 15 of 16 first hex chars (`0`-`e`) sort below opencode's prefix → ~89% of second-and-later prompts to any session triggered the guard, exited the loop at step=0, silently swallowed the prompt. Stuck-detector reported `verdict=stuck, cause=no-dispatch`. First prompt of fresh sessions always worked because `lastAssistant?.finish` short-circuited (no prior assistant to compare against) — which is why the bug hid behind "new sessions seem fine".
- Fix landed in `4537a0d`: portal-generated messageIDs now start with `msg_f...`. `f` is the only hex char that always sorts greater than any opencode-generated ID in the wild. Applied in both [apps/web/src/server/opencode/[port]/session/[id]/prompt.ts](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/opencode/%5Bport%5D/session/%5Bid%5D/prompt.ts#L160) and [command.ts](file:///home/nowaker/projekty/webapps/portal/apps/web/src/server/opencode/%5Bport%5D/session/%5Bid%5D/command.ts#L55). Long load-bearing comment in prompt.ts documents: the bug, why the `f` is non-removable, when to remove (when opencode replaces lex compare with `time.created` numeric compare), what to do if opencode's prefix ever rolls past `f...` (years away).
- Drive-by in same commit: command.ts had a TDZ bug where `opencodeMessageId` was referenced in the `archivePrompt` call 8 lines before its `const` declaration — slash-command dispatch was throwing `ReferenceError` at runtime since `b6cc833`. Declaration reordered above the archive call.
- Full forensic analysis committed at [ai-analysis-requests/STUCK_NO_DISPATCH_LEXICOGRAPHIC_ID_BUG.md](file:///home/nowaker/projekty/webapps/portal/ai-analysis-requests/STUCK_NO_DISPATCH_LEXICOGRAPHIC_ID_BUG.md): the stuck-detector full output, why-first-prompt-worked-but-second-didn't analysis, proof across 5 stuck sessions, ruled-out alternatives, recovery procedure, when to remove the workaround.
- Test verification before merge: fired `msg_f...`-prefixed `prompt_async` to all 5 stuck `no-dispatch` sessions in this project (`ses_1961e22d6...`, `ses_1983566f5...`, `ses_1982abce8...`, `ses_198788003...`, `ses_199f94180...`). Every one transitioned from `stuck/no-dispatch` to `in-progress` on the first try. Confirmed the workaround unblocks the existing stuck queue as well as preventing future stuckness.
- Initially shipped on branch `fix/prompt-id-f-prefix` per the analyze-mode hook's "don't merge / don't deploy" prelude. User redirect ("DEPLOY AND FIX ALL SHIT") clarified that was a misread — the prelude applied to the analysis turn only. Rebased onto main, fast-forwarded to `4537a0d`, pushed to both remotes, deployed via `scripts/deploy.sh`.
- Separate bug NOT addressed by this commit: the 2 `stuck/stale-stream` sessions (`ses_1983fb909...`, `ses_19897fcbf...`) have an in-flight assistant message that opencode considers still running but with no live runner. Class of bug from the May 26 22:24:56 systemd-timeout-during-stop event that SIGKILL'd opencode mid-LLM-stream. Recovery requires `POST /session/<sid>/abort` + re-fire. Tracked separately. (Post-deploy follow-up: aborted both via `POST /session/<sid>/abort` then re-fired with f-prefix `prompt_async`. Both now in-progress with healthy LLM streams.)
