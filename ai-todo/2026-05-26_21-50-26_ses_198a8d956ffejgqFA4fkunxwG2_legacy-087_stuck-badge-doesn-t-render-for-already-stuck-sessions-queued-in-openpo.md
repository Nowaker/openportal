---
status: DONE
session: ses_198a8d956ffejgqFA4fkunxwG2
queued_at: 2026-05-26T21:50:26-05:00
legacy_number: 87
commits:
  attributed:
    - 209474e516d3
  on_main:
    - 209474e516d3
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# STUCK badge doesn't render for already-stuck sessions; "queued in openportal but invisible in opencode web UI" follow-up has same root cause

User prompt (verbatim), turn 1:

> https://portal.desktop.ts.nowaker.net:8443/session/ses_199f94180ffeYBjaI0fuz5pfGw?server=srv-2dy1srwz
> Look at this session. It has multiple messages queued but runner didn't pick it up. Opencode server restart could cause it, no issue here. But openportal uses stuck detector (../../nowaker/opencode-tools) to detect stuck sessions and visualize it. Why didn't it happen here? Stuck detector bug or openportal not using it correctly bug? Whichever the same, fix it.

User prompt (verbatim), turn 2 (follow-up with a second affected session, [analyze-mode]):

> And also this one: https://portal.desktop.ts.nowaker.net:8443/session/ses_1adcb0fddffenglncs0bYf820u?server=srv-2dy1srwz#msg-msg_e465188ccebf4ce7b417cd76b042b9bd
> I see queued messages in openportal. Should detect stuck. BUT! opencode web ui doesn't show it at all. It only sees the assistant response "Both done. Final state summary:" https://portal.desktop.ts.nowaker.net:8443/session/ses_1adcb0fddffenglncs0bYf820u?server=srv-2dy1srwz#msg-msg_e24d7bc42e374a7e8cb8ec1708f129c3
> Why is what? Did openportal accept a message, but never submitted it to opencode? Or did opencode drop it somehow? Is the message present in opencode sqlite but not visible via api? Or what? What's going on here?

Design notes:

- Forensic answer to turn 2: the 4 trailing user messages ARE in opencode (verified by direct curl on `/session/<id>/message` AND by direct sqlite query on `~/.local/share/opencode/opencode.db`). OpenCode just isn't dispatching a runner - the "no-dispatch" stuck state. OpenCode's own web UI not showing trailing-user-no-assistant is an opencode-side rendering quirk; the data is there, the UI just doesn't draw it. NOT an openportal bug.
- Root cause for both turns is the same: `applyStuckVerdict()` in `apps/web/src/server/lib/indicator-state.ts` silently dropped stuck verdicts when no indicator-state entry existed for the session. Stuck sessions never have an entry because (a) opencode's `/session/status` returns only active runners (`{}` right now) so `hydrateFromStatusEndpoint` seeded nothing, and (b) stuck sessions don't emit SSE events that `processStream` could lazy-create from.
- Plugin verdict path was always correct: `GET /verdicts/<sid>` on `127.0.0.1:4098` returned `verdict=stuck cause=no-dispatch queued_user_msgs=N`. The bug was purely in how openportal routed that verdict into indicator-state.
- Fix shipped in `209474e`:
  - `applyStuckVerdict` gained an optional `seedTargets: Array<{serverId, port}>` field. When no existing entry matches, it creates one fresh entry per target so the verdict reaches the UI.
  - `apps/web/src/server/plugins/stuck-detector-client.ts normalize()` populates `seedTargets` via a new `resolveSeedTargets()` helper: if the plugin's `owner_instance_url` resolves to a configured server, seed only that one; else fan out across every configured server via `listConfiguredServers()`. Bounded ~100KB total in steady state.
- Live-verified after deploy: `/api/indicators` went from 0 sessions to 214 sessions (206 stuck), matching the plugin's stuck count exactly. Both reported sessions (`ses_199f941...`, `ses_1adcb0fdd...`) appear with stuck_verdict="stuck" cause="no-dispatch" under both configured serverIds (srv-2dy1srwz and srv-9myqtdk1). The STUCK badge (red pulsing, click-to-unstuck affordance) now renders in the title bar.
- Bonus finding (separate work item, NOT shipped here): 2 older prompts in openportal's `prompts` table (`66997cb4-...`, `97d1828b-...` from 2026-05-18/19) have status='delivered' but opencode_message_id IS NULL. Their text doesn't appear in opencode's `part` rows. Pending-prompt-worker probably has a race that sets `delivered_at` before parsing opencode's response (or opencode silently dropped them and openportal marked delivered anyway). Tracked as a separate todo against `apps/web/src/server/plugins/pending-prompt-worker.ts`.
- Secondary noise (NOT shipped here): `[stuck-detector-client]` SSE drops every ~30s with "socket connection closed unexpectedly". The reconnect+snapshot loop recovers each time, so verdicts propagate after this fix. If it stays annoying, fix in opencode-tools (likely Bun.serve idle-SSE timeout or Bun client keep-alive).
- Full analysis: [ai-analysis-requests/STUCK_SESSION_VISIBILITY.md](ai-analysis-requests/STUCK_SESSION_VISIBILITY.md).

---
