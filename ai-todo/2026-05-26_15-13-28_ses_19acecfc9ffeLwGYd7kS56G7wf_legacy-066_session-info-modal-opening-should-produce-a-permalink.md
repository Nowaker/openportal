---
status: DONE
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T15:13:28-05:00
legacy_number: 66
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Session info modal: opening should produce a permalink

User prompt (verbatim):

> enque as next tasks: opening session info modal does not result in a permalink.

Design notes:
- Portal AGENTS.md `Everything is a permalink` section already says Session Info modal should use `useHashOpen("info")` at `/session/<id>#info`. User reports the hash is NOT appearing when the modal opens — either the modal stopped using `useHashOpen`, or `useHashOpen` regressed and stopped writing to `location.hash`.
- Investigation steps: find current open-the-modal call site (search for "Session info" / SessionInfoModal openers). Verify it routes through `useHashOpen("info")`. If it's calling a separate state hook (useState), swap to `useHashOpen`. Cross-check the close path too — Esc / backdrop / X-button should `history.back()` or remove the hash so back-navigation lands on the prior URL, not on a sibling `#` state.
- Acceptance test: open the modal → URL gains `#info` → reload the URL → modal opens automatically → click X → URL drops `#info` → back button works as expected.
