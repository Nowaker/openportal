---
status: PENDING
session: ses_unknown
queued_at: 2026-06-03T15:30:00-05:00
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Restructure AI_TODO for multi-agent / multi-branch safety

User prompt (verbatim):

> how woudl we structure AI_TODO to be multi-branch / multi-agent friendly. propose a solution on a different branch that goes off of main branch. send me a gitlab link to review. should involve changing agents.md, and any other files/scripts/docs that have it.
>
> <N> no N, because there is no reliable counter, should be YYYY-MM-DD_HH-MM-SS_sessionid_title-in-dash-case.md
>
> and i will provide sessionid dynamically in custom instructions via hooks

Design notes:

- Full proposal in
  `ai-analysis-requests/AI_TODO_MULTI_AGENT_RESTRUCTURE.md`.
- Filename format: `YYYY-MM-DD_HH-MM-SS_sessionid_title-in-dash-case.md`.
  No N counter. No collisions possible (sessionid + timestamp is
  unique).
- AGENTS.md "AI_TODO.md is the canonical task queue" section
  replaced with a shorter `ai-todo/` directory-based section.
  "Safe diffs" and "Temp-file fallback" subsections deleted —
  no longer needed because there's no shared write target.
- Migration: Option A (freeze legacy `AI_TODO.md` at entry #190).
  Option B (full split into individual files) deferred.
- `sessionid` slot deliberately set to `ses_unknown` in this
  example entry because the user's custom-instructions hook that
  injects the session ID isn't live yet at the time the proposal
  was written. Once the hook is in place, future agents fill it
  in. The user can rename this file once they wire the hook.
- `.gitignore` entry for legacy `AI_TODO_*_ses_*.md` temp files
  removed in the proposal — the temp-file fallback mechanism is
  obsolete under the new scheme.
- This entry is the proposal's own "self-documenting" first
  inhabitant of `ai-todo/` — its existence demonstrates the
  format end-to-end.
