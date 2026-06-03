---
status: DONE
commit: 695ae79
session: ses_019de0d38c6euLKwWoRhFZdgzg
queued_at: 2026-05-15T19:31:55-05:00
legacy_number: 6
---

# Server-permalink missing in sidebar links

User prompt:

> links in sidebar don't include server permalink. screen other places where server permalink missing.

Concrete audit task: walk every `<a>` / `navigate(...)` in the codebase; flag any that omits the `?server=<id>` query param. Use a `linkTo(...)` helper that auto-injects active server.
