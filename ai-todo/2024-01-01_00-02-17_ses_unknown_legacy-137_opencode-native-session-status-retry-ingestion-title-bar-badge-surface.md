---
status: PENDING
session: ses_unknown
queued_at: 2024-01-01T00:02:17-05:00
legacy_number: 137
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Opencode-native session.status retry ingestion + title-bar badge surface

User prompt (verbatim):

> Add OpenPortal surfacing for opencode-native session.status retry/usage-limit state (and audit/fix other silently dropped signals), with live countdown + attempt text in session view and session list indicators, plus tests and live API verification.

Design notes:

- opencode v1.15.12 emits SSE `session.status` with a discriminated union: `{type:"idle"|"busy"|{type:"retry", attempt, message, next, action?}}` (authoritative source: `~/projekty/webapps/opencode/packages/opencode/src/session/status.ts`).
- Two latent bugs on main-nowaker today:
  1. `apps/web/src/server/lib/indicator-state.ts:222` reads `props.info.time.completed` from session.status frames - wrong shape. Real opencode events have `props.status.{type,...}`. Retry frames silently dropped at the indicator boundary; busy/idle still works only because `message.created` + `session.idle` events keep busy/idle in sync independently.
  2. `apps/web/src/server/plugins/indicator-broadcaster.ts:205` hydrate path synthesises the same broken shape from `/session/status` REST output. The REST endpoint returns the same `Info` union; `.time.completed` doesn't exist on it.
- Fix: add a new `opencode_retry: { attempt, next (absolute Unix ms), message, action? } | null` field on `SessionIndicatorState`. Separate channel from the stuck-detector-fed `retry` field so the two authoritative sources don't stomp each other. Populate from session.status SSE in both the live handler and the hydrate path. Expose via `pickBadgeStatus`.
- Picker priority: retry surfaces BEFORE tool/thinking. The current priority chain doc had retry as #8 after thinking, which is dead code because busy=true triggers thinking first. Updated chain in `apps/web/src/lib/session-status.ts`.
- Live countdown component (RetryCountdownBadge ticking every 1s) is a polish follow-up under this entry's todo list - this commit ships the snapshot title only.
- Worktree: `~/projekty/webapps/portal-session-status-retry` on branch `session-status-retry-ingest` off `main-nowaker` @ 5249d8d.
- Follow-ups (also in this entry's todo list):
  - `ai-analysis-requests/SESSION_STATUS_SIGNAL_AUDIT.md` enumerating every session.status type + relevant message Part types and surfaced-vs-dropped per portal indicator/chat path.
  - Live verification: trigger retry on opencode and confirm portal indicator shows it end-to-end.
