---
status: DONE
session: ses_229d7083fffem6lkaEj69adZ7H
queued_at: 2026-05-22T22:11:11-05:00
legacy_number: 3
commits:
  attributed:
    - 661d1e724580
  on_main:
    - 661d1e724580
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Section N — Archive session in right hamburger

User prompt:

> right hamburger: add archive session to there.

Design notes:
- Toggle "Archive session" / "Unarchive session" based on `session.time_archived`.
- Backend: PATCH `/session/<sid>` with `{ time: { archived: <ms-or-null> } }` — opencode's UpdatePayload supports this (verified at opencode `session.ts:173`).
- Confirmation dialog; SWR mutate after.
