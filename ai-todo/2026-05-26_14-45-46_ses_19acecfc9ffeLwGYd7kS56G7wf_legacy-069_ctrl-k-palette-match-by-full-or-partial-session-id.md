---
status: DONE
commit: ab63e9c
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T14:45:46-05:00
legacy_number: 69
---

# Ctrl+K palette: match by full or partial session ID

User prompt (verbatim):

> after: ^K should also work by session id, e.g. i paste ses_229d7083fffem6lkaEj69adZ7H and my match is the session with that session id.

Design notes:
- Existing prefix-match in `cmd.tsx rankSessions` was shipped at `2eba984` (entry #36 — "Quick search by partial session ID"). User reports it doesn't match for FULL pasted session IDs. Investigate: likely the matcher's prefix branch requires query.length < session.id.length, or the matcher only triggers on `ses_` prefix and not the full ID.
- Acceptance: pasting `ses_229d7083fffem6lkaEj69adZ7H` matches THAT session (no other). Pasting `ses_229d7083f` matches the same session as a prefix. Pasting `ses_` lists all sessions sorted by activity.
