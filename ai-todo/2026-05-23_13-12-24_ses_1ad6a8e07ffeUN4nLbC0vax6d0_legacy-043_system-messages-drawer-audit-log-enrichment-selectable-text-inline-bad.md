---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T13:12:24-05:00
legacy_number: 43
commits:
  attributed:
    - e2d080afb70d
  on_main:
    - e2d080afb70d
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# System messages drawer: audit log enrichment + selectable text + inline badge + 3-mode scoping + wider modal

User prompts (multiple, all extending entry #32):

> system messages -> scoping of messages global+all projects, and global+current project, and also global+current session, should be switchable in the modal. make the modal 50% wider. switchable kinda like you can switch between json and formatted view in some other modal. same ui interface for that.

> it appears logs in system messages aren't selectable. DO NOT DISABLE SELECTION OF TEXTS NILLY WILLY. permanent rule to be added to agents.md. if it's a text it must be selectable.

Design notes:
- Audit-log enrichment landed across multiple commits to address the "the server has been running long and nothing is in the log" follow-up from #32: move-to-project completions / archive / unarchive / compaction (e2d080a), auto-approve toggles + session pin/unpin (f9f454d), build-mismatch / version-detected with both build IDs spelled out (c7ac517 + e29123b), inline-badge layout (affceef removes ml-auto stretching so the count sits next to the label).
- Drawer modal widened max-w-md → max-w-2xl (50% wider per user spec; matches the breathing room the dry-run output dialogs got in #33).
- 3-mode scoping toggle in drawer header (commit 17d0792): `kind: "all" | "project" | "session"` switcher rendered with the same json/formatted ui pattern from ToolInputModal. `SystemMessage.sessionId?: string | null` added; system-wide messages (no projectDirectory + no sessionId) ALWAYS visible in all 3 modes. Modes whose context is unavailable (e.g. no current session) are visually disabled.
- Selectable-text fix (9bc5fc2): the drawer's details panel was wrapped in a `<button>` for click-to-expand, which suppresses text selection inside. Restructured so the expandable region's text lives OUTSIDE the click target — the expand toggle is a sibling control, the text body is plain `<pre>`. Added the AGENTS.md "## UX preferences -> Text selection (mandatory)" section codifying the rule for all future UI.
