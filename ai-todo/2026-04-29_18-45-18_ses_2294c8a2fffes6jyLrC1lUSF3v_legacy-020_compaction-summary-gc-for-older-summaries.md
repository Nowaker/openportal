---
status: Q-DEFERRED
session: ses_2294c8a2fffes6jyLrC1lUSF3v
queued_at: 2026-04-29T18:45:18-05:00
legacy_number: 20
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Compaction-summary GC for older summaries

User prompt (paraphrased from the user's own per-session analysis):

> Garbage-collect orphaned compaction summary parts — LOW ROI. Older compaction summary text is in the DB even after newer compactions supersede it. ~15 MB.

Low-priority DB cleanup. Could be implemented as a portal cleanup script OR (preferred) as a flag on `clean-session.ts` (which now exists in opencode-tools with `--prune-*` opt-in flags). Move to opencode-tools backlog.
