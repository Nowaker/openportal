---
status: DONE
session: ses_1b66ba2aaffeW7xyxcjmde6oYq
queued_at: 2026-05-21T16:13:54-05:00
legacy_number: 13
commits:
  attributed:
    - 0b8cbcb1a3c2
  on_main:
    - 0b8cbcb1a3c2
  reverted: false
verdict: present
verdict_reason: "Commit 0b8cbcb on main: 'title-bar: context dial opens Session Info + hamburger closes on Android back'. SessionContextDial.onClick={() => setShowSessionInfo(true)} at apps/web/src/components/app-sidebar-nav.tsx:897-900"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Click-on-session-context-fullness-indicator → Session Info regression check

User prompt:

> Clicking the session context fullness indicator still doesn't open session into[fo].

Commit `0b8cbcb` claims to land "context dial opens Session Info". The user's complaint came AFTER that commit. Possible regression. Verify behavior next session.
