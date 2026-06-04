---
status: DONE
session: ses_242dd72b5ffeg8fAcRybH3twQA
queued_at: 2026-04-24T22:28:28-05:00
legacy_number: 172
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

# Escape in Ctrl+K closes the modal instead of clearing the query

User prompt (verbatim):

> [search-mode]
> MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:
> - explore agents (codebase patterns, file structures, ast-grep)
> - librarian agents (remote repos, official docs, GitHub examples)
> Plus direct tools: Grep, ripgrep (rg), ast-grep (sg)
> NEVER stop at first result - be exhaustive.
>
> ---
>
> also enqueue: filter through ALL sessions in open workspaces. i don't know why but ^K doesn't show me ses_1d159bb7bffeBYnvWNAsL0c4Si when i search by 
>
> also enqueue: escape in ^K clears input. that's weird. just close the modal. you hit ^K, previous input is there (but selected, as per one of my requests), no issue.
>
> continue

Design notes:

- Override or remove the current Escape-to-clear behavior in the Ctrl+K search field.
- Escape should close the palette without mutating the remembered query.
- On the next Ctrl+K open, the previous query should still be present and selected per #169.
- Verify keyboard behavior: Ctrl+K open, type, Escape close, Ctrl+K reopen, type-to-replace, ArrowRight-to-append.
