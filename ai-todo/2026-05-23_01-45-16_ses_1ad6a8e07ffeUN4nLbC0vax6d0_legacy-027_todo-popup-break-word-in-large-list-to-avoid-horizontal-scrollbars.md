---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T01:45:16-05:00
legacy_number: 27
commits:
  attributed:
    - dac4662bb97e
  on_main:
    - dac4662bb97e
  reverted: false
verdict: present
verdict_reason: "Commit dac4662 on main: 'todo-strip: popup opens directly above + inherits width + break-word'. overflow-wrap:anywhere at apps/web/src/components/todo-strip.tsx:18,291"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Todo popup: break-word in large list to avoid horizontal scrollbars

User prompt:

> break words in  large todo to avoid horizontal scrollbars

Design notes:
- Large-popup mode of the todo strip: long unbroken tokens (URLs, file paths, identifiers) trigger horizontal scrollbars instead of wrapping.
- Use CSS `word-break: break-word` / `overflow-wrap: anywhere` / `min-width: 0` on the popup body to force wrapping.
- Cross-reference: same surface as #21 + #26 — likely one combined commit once visual validation (#26) confirms the new positioning.
