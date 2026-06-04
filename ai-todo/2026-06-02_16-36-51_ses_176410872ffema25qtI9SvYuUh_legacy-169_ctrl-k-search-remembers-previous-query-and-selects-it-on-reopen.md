---
status: DONE
session: ses_176410872ffema25qtI9SvYuUh
queued_at: 2026-06-02T16:36:51-05:00
legacy_number: 169
commits:
  attributed:
    - 11bcb7795134
  on_main:
    - 11bcb7795134
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Ctrl+K search remembers previous query and selects it on reopen

User prompt (verbatim):

> add to todo now, execute afterwards: ^K remembers previous search on subsequent ^K hit. on subsequent open, select all content in the search field (like browsers do on ^L), so when i start typing i overwrite current content. and if press right arrow, i concatenate.

Design notes:

- Do not clear the palette query on close/reopen.
- On subsequent Ctrl+K open, focus the search field and select the entire existing query so normal typing replaces it.
- Preserve browser-like caret behavior: pressing ArrowRight should collapse selection at the end so typed text concatenates to the remembered query.
- Implement in the shared Ctrl+K search component if both sidebar button and keyboard shortcut use it.
