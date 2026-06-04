---
status: DONE
session: ses_1b66ba2aaffeW7xyxcjmde6oYq
queued_at: 2026-05-22T15:52:37-05:00
legacy_number: 10
commits:
  attributed:
    - 177e865535d7
    - 2bda92034bc0
  on_main:
    - 177e865535d7
    - 2bda92034bc0
  reverted: false
verdict: present
verdict_reason: "Commits 177e865 + 2bda920 on main. prioritizeForProject(config.entries, project, max) at apps/web/src/routes/files.tsx:435"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# "All lists prioritize files from current project first" — refinement

User prompt:

> more info re "all lists prioritize files from current project first, then a horizontal separator, then all files (minus current project's)"

Refinement of #9's ordering. Apply the 2-section structure (current-project first → separator → rest) to ALL file lists (recent files, mentions, file-mention popover suggestions, bookmarks if applicable).
