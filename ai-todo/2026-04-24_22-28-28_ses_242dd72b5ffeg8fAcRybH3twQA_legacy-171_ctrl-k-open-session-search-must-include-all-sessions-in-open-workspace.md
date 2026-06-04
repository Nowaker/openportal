---
status: DONE
session: ses_242dd72b5ffeg8fAcRybH3twQA
queued_at: 2026-04-24T22:28:28-05:00
legacy_number: 171
commits:
  attributed:
    - 11bcb7795134
  on_main:
    - 11bcb7795134
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Ctrl+K open-session search must include all sessions in open workspaces

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

- Investigate how Ctrl+K sources candidate sessions versus sidebar/open-workspace session data.
- Expand the candidate set to all sessions in open workspaces so known sessions such as `ses_1d159bb7bffeBYnvWNAsL0c4Si` appear when searched.
- Preserve any intentional exclusions for archived/deleted sessions unless the current code proves they are unrelated to this bug.
- Verify with a session ID outside the currently focused workspace if possible.
