---
status: PENDING
session: ses_189a87774ffe56ZAXii1W2227P
queued_at: 2026-05-29T23:10:42-05:00
legacy_number: 134
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Archived-session placement and highlight parity in sidebar

User prompt (verbatim):

> after archiving, navbar should update - archived session needs to go where it belongs.
> also, current session is being highlighted green. that was overlooked and not implemented for archived ones. they should be highlighted also. (if within view - ie the archived section where it belongs is currently in view)

Design notes:

- When the current session becomes archived, the project's archived subsection should become visible so the row appears in its archived location immediately.
- Archived rows must receive the same active-session highlight treatment as active rows when they are visible.
- Keep the existing collapsed behavior for archived sections when the current session is not archived.
- Target file: `apps/web/src/components/app-sidebar.tsx`.
