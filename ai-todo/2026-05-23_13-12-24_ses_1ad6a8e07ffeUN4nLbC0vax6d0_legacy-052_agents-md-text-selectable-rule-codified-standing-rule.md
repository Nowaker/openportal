---
status: DONE
commit: 9bc5fc2
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T13:12:24-05:00
legacy_number: 52
---

# AGENTS.md: text-selectable rule (codified standing rule)

User prompt:

> it appears logs in system messages aren't selectable. DO NOT DISABLE SELECTION OF TEXTS NILLY WILLY. permanent rule to be added to agents.md. if it's a text it must be selectable.

Design notes:
- Added `## UX preferences -> Text selection (mandatory)` section to portal `AGENTS.md`. Hard rules: never add `select-none` (Tailwind) or `user-select: none` (raw CSS) to any element containing text. Existing `select-none` on text elements MUST be removed unless justified by a comment naming a real use case (drag handles, image-like decorations, badges that are purely visual icons).
- For "prevent text drag while keeping selection": use `draggable={false}` or `WebkitUserDrag: 'none'`, not `user-select: none`.
- Reviewers may revert any `select-none` addition on a text element without further discussion.
