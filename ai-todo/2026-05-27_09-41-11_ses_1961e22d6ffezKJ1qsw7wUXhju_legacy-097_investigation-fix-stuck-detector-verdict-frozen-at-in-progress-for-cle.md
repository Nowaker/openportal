---
status: DONE
session: ses_1961e22d6ffezKJ1qsw7wUXhju
queued_at: 2026-05-27T09:41:11-05:00
legacy_number: 97
commits:
  attributed: []
  on_main: []
  reverted: false
verdict: present
verdict_reason: "External opencode-tools commit dea56e7: 'stuck-detector: downgrade in-progress/stuck verdicts to idle on clean completion'. Analysis doc at ai-analysis-requests/STUCK_VERDICT_FROZEN_IN_PROGRESS.md"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Investigation + fix: stuck-detector verdict frozen at `in-progress` for cleanly-completed sessions

User prompt (verbatim):

> What is the current state of session https://portal.desktop.ts.nowaker.net:8443/session/ses_1982abce8ffezvjg4sZJArAJGZ?server=srv-2dy1srwz? Portal is showing it as in progress. What does stuck detector say about it? And if the session is idle / done with everything, why is portal showing it as in progress? Is it cached on the database? Why didn't it update it over these many hours? Investigation. Don't mutate anything.

Follow-up user prompt (verbatim):

> Fix the pługin.

Design notes:

- Full investigation written to [ai-analysis-requests/STUCK_VERDICT_FROZEN_IN_PROGRESS.md](file:///home/nowaker/projekty/webapps/portal/ai-analysis-requests/STUCK_VERDICT_FROZEN_IN_PROGRESS.md), already committed to the portal repo as `73ff429`. No portal code mutation; the fix landed in opencode-tools.
- TL;DR of the bug: opencode considered `ses_1982abce8` DONE (last assistant `msg_e6811274f` had non-null `time.completed`; session NOT in opencode's runtime busy map). Portal's own `busy`/`idle` was also correct (`busy: false, idle: true, inFlightAssistantId: null`). The "in progress" UI badge was driven by `stuck_verdict === "in-progress"` in [session-status.ts:217](file:///home/nowaker/projekty/webapps/portal/apps/web/src/lib/session-status.ts#L217) and [use-opencode.ts:142](file:///home/nowaker/projekty/webapps/portal/apps/web/src/hooks/use-opencode.ts#L142). That verdict was **frozen at the moment the session completed** (`computed_at_iso: 2026-05-27 06:14:33Z`, ~4s before `msg_e6811274f.time.completed`).
- Root cause was in the stuck-detector plugin leader (`~/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts`). `leaderTick` collects `allBusy` from worker `/session/status` polls. `scanBusyVerdicts` only iterates `allBusy`. `scanDbStuckCauses` iterates the complement but only emitted when fresh DB verdict was `"stuck"`. **No path downgraded an existing `in-progress` verdict to `idle` when a session finished normally.** The leader scan tick re-confirmed the bug every ~5s by inaction.
- Same pattern observed in `ses_198683d51` (computed `09:51:05Z`) and `ses_1983566f5` (computed `05:57:37Z`) — both also had `last_event_at_ms: null` and `opencode_runtime_busy: true` frozen. Class bug, not a one-off.
- SQLite caches (`messages_cache`, `sessions_cache`) were NOT the source. Both correctly reflected the completed state. They carry no busy field; the in-progress signal flows purely through the in-memory `indicator-state` Map seeded from the plugin.
- **Fix shipped**: opencode-tools commit `dea56e7` extends `scanDbStuckCauses` to downgrade any cached non-idle verdict (in-progress OR stuck) to idle when the session has left `allBusy` AND the fresh DB classification is idle. `broadcastDelta` fires so live SSE subscribers update without waiting for a portal restart. The downgrade preserves `last_event_at_ms` / `last_event_type` / `last_action_at_ms_by_cause` via `upsertVerdict`'s existing merge logic.
- Six new tests in `opencode-stuck-detector/tests/unit.test.ts` cover: in-progress→idle on clean completion, stuck→idle after recovery, preservation of last_event fields, no-op when in allBusy, no-op when fresh verdict still in-progress, no materialisation for sessions without a prior verdict. All 40 tests pass.
- Open questions from the original investigation, resolved by the shipped fix:
  1. Fix scope: opencode-tools (leader-side) chosen — authoritative path, single source of truth.
  2. Bulk-clear pass at portal startup: NOT NEEDED — the next leader scan tick will downgrade existing stale verdicts naturally (DB confirms idle, session not in allBusy, path triggers).
  3. Generalised to both `in-progress→idle` AND `stuck→idle` since the same bug pattern affects post-recovery stuck verdicts.
- **Operational note**: the fix only takes effect after the leader opencode (`opencode-serve-lan.service` on port 4098) restarts and reloads plugin code. Until then portal will keep showing frozen in-progress badges. Restarting that one service is sufficient; the worker on `opencode-serve-tailscale.service` picks up new state via `/verdicts` on next scan tick. I did NOT do the restart per AGENTS.md "never restart user-managed opencode" rule.
- @opencode-ai/plugin added as devDependency in opencode-tools so tests can import scanDbStuckCauses directly. Runtime is unaffected (opencode's own node_modules provides the package).
- Originally drafted as #93 (then #96) in this session but lost both numbers to parallel-session activity on `main-nowaker` (reset/amend/rebase/merge visible in reflog). Parked in gitignored temp file (`AI_TODO_20260527_1230_stuck_idle_downgrade_ses_1982abce.md`) per AGENTS.md safe-diff fallback. Folded in here as #97 after `5c8f28e` (#96 DONE) stabilised the tree; temp file deleted in this same commit.
