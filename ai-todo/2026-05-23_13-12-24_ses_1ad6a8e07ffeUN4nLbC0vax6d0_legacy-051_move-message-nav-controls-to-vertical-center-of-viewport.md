---
status: DONE
commit: 38af7b9
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T13:12:24-05:00
legacy_number: 51
---

# Move message-nav controls to vertical center of viewport

User prompt:

> enqueue to end: move navigation between messages, plus stickiness indicator and clicker to the middle (vertically).

Design notes:
- In `routes/_app/session/$id.tsx`, the nav button stack (prev / next / sticky-bottom indicator) was anchored bottom-right at `bottom-24`. Changed to `top-1/2 -translate-y-1/2 right-3` so the stack vertically centers regardless of viewport height. Keeps the buttons reachable on phones (thumb arc) and out of the way of the composer overlay on desktop.
