---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T01:28:13-05:00
legacy_number: 24
commits:
  attributed:
    - a1c65c187f52
  on_main:
    - a1c65c187f52
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# OpenPortal system-messages drawer (always-accessible from bottom-left)

User prompt:

> introduce a concept of openportal system messages / high level logs, always accessible from bottom left dropdown. things like lost connection, restored connection, restart attempted, restart error, etc. would go there. update readme.md with that - important messages should go there.

Design notes:
- New always-accessible dropdown / drawer from bottom-left of the layout. Acts as the audit log for OpenPortal-side events (NOT chat content).
- Categories: connection (lost / restored), service restart (attempted / success / error), plugin install events, notification permission changes, anything else that today fires a toast-and-forgets.
- Persistence: in-memory ring buffer (last N events, N ~ 200) per browser tab. localStorage persistence across reloads is a v2 follow-up.
- Affordances: timestamp + category badge + short message + expandable detail block (full error text, stack trace where applicable).
- Update README.md with the concept so the contract is documented (important messages route through the drawer, NOT just toasts).
- The systemctl-restart-alert fix from #23 should integrate with this drawer once both ship — the restart error should ALSO write to the drawer so it survives toast dismissal.
