---
status: DONE
session: ses_17693d98dffes5r0F6Eaz3KdHA
queued_at: 2026-06-02T12:40:28-05:00
legacy_number: 175
commits:
  attributed:
    - 3adcbb3cbd79
  on_main:
    - 3adcbb3cbd79
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Always render original prompt + last N messages when loading a session

User prompt (verbatim):

> when loading session in openportal, it should always load its original user prompt AND last x messages (whatever it's set up to currently).
> use existing infrastructure for frontend presentation - where if there's missing content in-between, it's presented correctly, with load buttons, etc.

Design notes:

- Server: `/api/opencode/<port>/session/<id>/messages?first=1` returns a single-element array with the first user message of the session. Always filters to `role==="user"` regardless of the `onlyUser` flag. Response carries `X-Messages-Total` (full session) and `X-Messages-Total-User` headers so the client can compute gap size between this first message and the recent-N window.
- Client hook: `useFirstSessionMessage(sessionId, { enabled })` in `apps/web/src/hooks/use-session-messages.ts`. Uses SWR with `refreshInterval: 0` + `dedupingInterval: 60_000` because the first prompt of a session never changes. Returns `{ message, totalCount, totalUserCount, isLoading, error }`.
- Route: `apps/web/src/routes/_app/session/$id.tsx` wires `useFirstSessionMessage` (disabled while permalink-mode is active) into `messageNodes`. The new logic detects if the first user message is already present in the loaded window (e.g. session has <50 messages, or "prompts only" with <50 user prompts) — in that case nothing extra is rendered. When the first message is NOT in the window, a header section renders the first message followed by the existing `PermalinkGapBanner` (with the "Load top 50 more" button hidden — only "Load all (slow)" is wired, since "Load 50 more" remains the user-driven flow at the bottom of the window).
- Behaviour matrix:
  - Session <= 50 messages: nothing extra rendered (existing window already contains the first prompt).
  - Session > 50 messages: first prompt at top + gap banner + last 50 messages below. Clicking "Load all (slow)" switches the existing `loadAllMessages` SWR variant, which is the same affordance as the existing pre-list "Load all" button.
  - "Prompts only" toggle with <= 50 user prompts: nothing extra rendered.
  - "Prompts only" toggle with > 50 user prompts: header renders the same way; gap size uses `X-Messages-Total-User`.
  - Permalink mode (`#msg-<id>`) unchanged: `useFirstSessionMessage` is disabled, so the permalink window loader remains the sole renderer.
- `PermalinkGapBanner` updated: `onLoadTop` is now optional. When omitted (the new "first prompt" use case), only the "Load all" button + the gap-count description render.
- Build + verify:
  - `bunx tsc --noEmit` from `apps/web/`: my three touched files (`use-session-messages.ts`, `session/$id.tsx`, `server/opencode/[port]/session/[id]/messages.ts`) introduce ZERO new errors. Remaining errors at lines 655/657/3350/6086 in `$id.tsx` and 111/134/164/177 in `messages.ts` are pre-existing on `main-nowaker`.
  - Worktree rebuild + restart on port 5310 succeeds. `?first=1` against `ses_17a4357eaffeBCOC4pX5u4HXKI` returns the correct user message id with `x-messages-total: 163` / `x-messages-total-user: 10`.
  - Manual API verification: in normal mode (last 50 of 163 messages), the first message id is NOT present in the window → gap banner WILL render. In `?onlyUser=1` mode (10 of 10 user messages), the first id IS present → my `firstIsLoaded` guard correctly suppresses the banner.
- Integration: developed on worktree `~/projekty/webapps/portal-load-first-and-last` / `feat/load-first-and-last`. Rebased on `main-nowaker` post-implementation to absorb commits `9a1c45a / 9b75da4 / 11bcb77`. At session end, if main worktree (`~/projekty/webapps/portal`) is clean, merge this branch into `main-nowaker` and run `bash scripts/deploy.sh`; if it's still dirty from concurrent work, defer the merge and just push the feature branch.
