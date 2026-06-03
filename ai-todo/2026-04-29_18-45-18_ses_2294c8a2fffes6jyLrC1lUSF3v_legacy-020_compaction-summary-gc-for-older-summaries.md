---
status: Q-DEFERRED
commit: 
session: ses_2294c8a2fffes6jyLrC1lUSF3v
queued_at: 2026-04-29T18:45:18-05:00
legacy_number: 20
---

# Compaction-summary GC for older summaries

User prompt (paraphrased from the user's own per-session analysis):

> Garbage-collect orphaned compaction summary parts — LOW ROI. Older compaction summary text is in the DB even after newer compactions supersede it. ~15 MB.

Low-priority DB cleanup. Could be implemented as a portal cleanup script OR (preferred) as a flag on `clean-session.ts` (which now exists in opencode-tools with `--prune-*` opt-in flags). Move to opencode-tools backlog.
