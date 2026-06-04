---
status: PENDING
session: ses_189a87774ffe56ZAXii1W2227P
queued_at: 2026-05-29T19:45:08-05:00
legacy_number: 133
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Archive confirmation split by trigger source

User prompt (verbatim):

> do not show this confirmation modal for archiving triggered from hamburger > archive.
> at the same time, trigeger it on slick from the navbar as thiere it's very easy to misclick that button.

Design notes:

- Keep the hamburger menu action fast: archive immediately from hamburger without opening the confirmation modal.
- Keep unarchive conservative in hamburger: still use confirmation there so destructive direction changes stay explicit.
- Move confirmation to the navbar archive affordance (session-row archive icon in the sidebar/nav surface), because misclick risk is highest there.
- Files:
  - `apps/web/src/components/app-sidebar-nav.tsx` - bypass modal for hamburger archive action.
  - `apps/web/src/components/app-sidebar.tsx` - add archive confirm dialog for session-row archive action.
- Verify manually by clicking both entry points and confirming behavior split matches prompt.
