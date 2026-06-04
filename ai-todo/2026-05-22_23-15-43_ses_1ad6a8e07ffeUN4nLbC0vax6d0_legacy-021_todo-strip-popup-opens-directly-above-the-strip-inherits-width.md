---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-22T23:15:43-05:00
legacy_number: 21
commits:
  attributed:
    - dac4662bb97e
  on_main:
    - dac4662bb97e
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Todo strip popup: opens directly above the strip; inherits width

User prompt:

> prompt area todo line, when clicked to expand, should behave almost like a dropdown, but nothing to select from that dropdown. it's really about where the todo list opens. it should open DIRECTLY ABOVE the todo line, and inherit its width (with a reasonable minimum, so it's not too narrow). this behavior partially applies to mobile. on mobile, open directly above too, but occupy 90% viewport width (5% from each side), and go up to 5% top. bottom must not go below the minified todo compoentnt i clicked. if todo list is long, vertical scrollbar ok.

Design notes:
- Desktop: popup opens DIRECTLY ABOVE the minified todo strip; inherits the strip's width with a reasonable minimum so it isn't too narrow.
- Mobile: opens directly above too, occupies 90% viewport width (5% margin each side), top bound at 5% from viewport top, bottom anchored at the clicked strip (must NOT extend below the minified component).
- Long lists: vertical scrollbar inside the popup. Never grow past the clicked element on the bottom side.
