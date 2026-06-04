---
status: DONE
session: ses_188e02aaaffeWDD8zi4iER82a2
queued_at: 2026-05-29T23:24:20-05:00
legacy_number: 135
commits:
  attributed:
    - 39d11a59b54c
  on_main:
    - 39d11a59b54c
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Remove OpenCode server-ID pre-generation from portal request paths

User prompt (verbatim):

> Work in /home/nowaker/projekty/webapps/portal.
>
> Task: fix OpenPortal so it never pre-generates OpenCode IDs that should be server-assigned.
>
> Context:
> - We hit a severe stuck-loop bug because message IDs were not monotonic in DB order assumptions.
> - User suspects OpenPortal pre-generated IDs; we must verify and eliminate this behavior at source.
>
> What to do:
> 1) Investigate all code paths in portal that call OpenCode HTTP APIs for session/message/prompt operations.
> 2) Determine whether OpenPortal pre-generates IDs for:
>    - message IDs
>    - session IDs
>    - part IDs
>    - any synthetic IDs passed to /session/:id/message or /prompt_async payloads.
> 3) Remove client-side ID generation for any server-assigned IDs. IDs must come from OpenCode server canonical generators only.
> 4) Keep compatibility: only pass IDs when API explicitly requires an existing ID reference.
> 5) Add regression coverage (tests) proving portal requests do not inject generated msg/session IDs.
> 6) Verify behavior end-to-end with curl (not SDK wrappers): create session, prompt_async twice, inspect /session/:id/message output and show IDs are server-generated and monotonic by creation flow.
> 7) Update AGENTS.md in this portal repo with a hard rule:
>    - never pre-generate OpenCode session/message/part IDs client-side;
>    - explain why this is harmful (breaks ordering assumptions, can create infinite loops / wrong latest message selection).
>
> Output requirements:
> - Implement code changes.
> - Run relevant tests/lint if available.
> - Provide concise summary with exact files changed and why this design (pre-gen IDs) is bad.
> - Include verification commands and observed outputs.
>
> Use model effort xhigh and build agent style in your own reasoning/execution.

Design notes:

- Audit all OpenCode-facing HTTP handlers and helpers for prompt/session/message flows, including long-op wrappers and direct opencode endpoint calls.
- Remove or block any client-generated IDs that are server-owned (`ses_*`, `msg_*`, part IDs), while preserving legitimate references to existing IDs for actions like revert, archive, move, and pagination anchors.
- Add regression tests around request payload construction so prompt/session calls cannot regress into injecting synthetic IDs.
- Verify with direct curl calls against OpenCode endpoints (no SDK abstraction) and capture observed ID patterns and ordering.
- Add an explicit AGENTS.md rule describing why local ID fabrication is dangerous for cache/order logic and can trigger stuck-loop behavior.
