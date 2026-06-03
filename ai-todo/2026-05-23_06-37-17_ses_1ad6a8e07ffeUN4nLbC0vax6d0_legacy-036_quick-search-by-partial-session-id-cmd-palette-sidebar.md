---
status: DONE
commit: 2eba984
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:37:17-05:00
legacy_number: 36
---

# Quick search by partial session ID (cmd palette + sidebar)

User prompt:

> Enqueue: Quick search session in navbar: also search by session id. Eg ses_1b665b000 should show the one marching this partial session id.

Design notes:
- `cmd.tsx` `rankSessions`: when the trimmed query starts with `ses_`, also try ID-prefix matching against `session.id`. Returns a synthetic high-score MatchResult (`10_000 + queryLength`) so the matched session pops to the top regardless of how its title or project label score.
- Sidebar `ProjectsList` filtering (`hasMatchingPin`, `filteredGroups`): add an ID-prefix branch when the query starts with `ses_`. Matches active + archived + pinned sessions.
- Falls back to standard case-insensitive substring title matching for queries that don't start with `ses_`.
