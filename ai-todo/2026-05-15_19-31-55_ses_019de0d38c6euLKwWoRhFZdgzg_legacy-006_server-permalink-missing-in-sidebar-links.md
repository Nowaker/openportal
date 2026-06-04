---
status: DONE
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-15T19:31:55-05:00
legacy_number: 6
commits:
  attributed:
    - 695ae79df95c
  on_main:
    - 695ae79df95c
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Server-permalink missing in sidebar links

User prompt:

> links in sidebar don't include server permalink. screen other places where server permalink missing.

Concrete audit task: walk every `<a>` / `navigate(...)` in the codebase; flag any that omits the `?server=<id>` query param. Use a `linkTo(...)` helper that auto-injects active server.
