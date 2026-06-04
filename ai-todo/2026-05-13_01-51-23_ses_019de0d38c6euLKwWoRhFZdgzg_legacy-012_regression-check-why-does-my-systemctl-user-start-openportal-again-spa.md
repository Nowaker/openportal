---
status: DONE
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-13T01:51:23-05:00
legacy_number: 12
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Regression check: "Why does my systemctl --user start openportal AGAIN spawn opencode on port 4000?!"

User prompt:

> why does my systemctl --user start openportal AGAIN spawn opencode on port 4000?!?!?!! we just barely turned it off and it's spawning again?

The user is on externalOpencode lifecycle mode — this should NOT happen. Smoke test next session: `systemctl --user restart openportal` then `pgrep -af "opencode serve"` should show ONLY user-managed opencodes (no portal-spawned children).
