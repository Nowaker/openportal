---
status: DONE
session: ses_17a9c305bfferyIXISgiQFdeUl
queued_at: 2026-06-01T17:52:52-05:00
legacy_number: 157
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Auto-revive sessions stopped with unexpected finish='unknown'

User prompt (verbatim):

> Implement OpenPortal backend handling for sessions that end in unexpected finish reasons (example: finish='unknown', shown as 'Stopped (unknown)'). Goal: automatically revive these sessions.
>
> Requirements:
> 1) Detect this specific failure mode robustly (DB/API evidence shape: terminal assistant message with finish='unknown', often empty/no content).
> 2) Auto-resume logic:
>    - First determine whether native resume without new user input exists in OpenCode runtime/API.
>    - If no true input-free resume exists, use the minimal safe revive prompt through prompt_async.
> 3) Use a wrapper style similar to OMO wrappers. Required surface format (or improved equivalent):
>    [ openportal: unknown error: Continue working diligently to fulfill all user's tasks. ]
> 4) If prompt_async is required, keep prompt very brief. You may improve this candidate:
>    <openportal handler="unknown error">
>    This session failed due to a network event. This prompt revives you. Continue working diligently to fulfill all user's tasks.
>    </openportal>
> 5) Ensure idempotency/safety:
>    - Do not spam resumes repeatedly for same terminal event.
>    - Avoid resuming when session is genuinely complete.
>    - Add guardrails/backoff and clear logging.
> 6) Add tests for detection + resume trigger behavior.
> 7) Follow project conventions and implement end-to-end, not just design notes.
>
> Deliverables:
> - Code changes in portal project
> - Short summary of mechanism chosen (input-free resume vs brief prompt_async)
> - Verification evidence (tests/manual checks)

Design notes:

- Inspect existing session lifecycle paths (`indicator-state`, SSE handlers, pending-prompt-worker, messages/session routes) to identify canonical source for terminal assistant status.
- Determine whether current integrated OpenCode API surface supports true input-free resume; if absent, implement minimal prompt-based revive wrapper through `prompt_async`.
- Add strict idempotency keying per terminal-event signature + guarded retry/backoff so one unknown terminal event triggers at most one revive in the backoff window.
- Keep revive prompt concise and wrapper-styled; include explicit OpenPortal origin marker for observability.
- Add focused server tests for detection (positive + negative) and trigger behavior (single fire, no spam, skip complete sessions).
