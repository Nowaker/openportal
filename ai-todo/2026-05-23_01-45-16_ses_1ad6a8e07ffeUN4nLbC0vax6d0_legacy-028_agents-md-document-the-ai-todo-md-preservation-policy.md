---
status: DONE
commit: 6aaba3e
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T01:45:16-05:00
legacy_number: 28
---

# AGENTS.md: document the AI_TODO.md preservation policy

User prompt:

> add to agents.md if not added yet: save every user prompt in AI_TODO.md, along with its todowrite full title, and AI's description of the task (consitent with what's alreaydy there in agents.md)

Design notes:
- Add a rule to portal-side `AGENTS.md` (or the user-level `~/.config/opencode/AGENTS.md` if more appropriate) that says: every user prompt that maps to a queueable task MUST be persisted to `AI_TODO.md` with three fields:
    1. Verbatim user prompt (in a blockquote)
    2. Full title (matching the `todowrite` entry exactly)
    3. AI's short description / design notes of what the task means
- This codifies the convention I've been following organically across the queue (Sections L, M, N, #21-#27).
- Check whether an analogous rule already exists in AGENTS.md (or its delegated rules) before adding a duplicate. If a related rule exists, EXTEND it rather than duplicate.
