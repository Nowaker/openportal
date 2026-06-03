---
status: DONE
commit: 5f3c103
session: ses_1907e1ca3ffeDsBKgJyG6i7IU4
queued_at: 2026-05-27T00:20:00-05:00
legacy_number: 90
---

# AGENTS.md: codify safe-diff + temp-file fallback for AI_TODO under concurrent writers

User prompt (verbatim):

> AI todo must be updated, always. Make it a project rule in agents MD if not clear. Practise safe diffs. Add to Ai todo in a way that minimizes possible merge conflicts. If can't add right away, create Ai todo _ yyyymmdd_hhmmss_session_title_ses_abcs1234sessidhere.md temporarily and later reincorporate it back in this same session at the end at merge time. Or  post merge.

Design notes:

- Parallel agents writing to AI_TODO.md from sibling worktrees /
  sessions is the steady-state load on this repo. The schema rule
  "every user prompt that maps to a queueable task MUST land in
  AI_TODO.md in the same turn" already existed in AGENTS.md; what
  was missing was operational guidance for HOW to land it without
  conflicting with the other agents' continuous edits.
- Two new operational rules under the AI_TODO.md section in
  AGENTS.md:
  1. **Safe diffs**: append-only at the END of the file (after the
     most recent numbered entry, before the trailing meta sections
     like Q-DEFERRED, ARCHITECTURE REFERENCE), one entry per commit
     when shipping AI_TODO-only changes (code+AI_TODO combo commits
     may ship 1-3 entries together), never renumber, never touch
     historical entries except to flip PENDING -> DONE - <commit>
     in place. Same-shape appends by parallel agents land on
     neighbouring lines and merge cleanly via git's three-way merge.
  2. **Temp-file fallback**: when AI_TODO.md is in
     `git ls-files --unmerged` state or visibly mid-edit by another
     agent (raw `<<<<<<<` markers, partial reformatting), write the
     intended entry to a per-session sidecar at
     `AI_TODO_<yyyymmdd>_<hhmmss>_<short_title>_<ses_id>.md` at the
     repo root. These files match the new `AI_TODO_*_ses_*.md`
     gitignore pattern so they sit in the working tree without
     polluting commits. Reincorporate into AI_TODO.md once the
     conflict resolves - either in the same commit that ships the
     work, or in a dedicated post-merge `AI_TODO.md: sync ...`
     commit - and delete the temp file. If a session ends with the
     sidecar still on disk, the next session must pick it up before
     starting new work; the filename's timestamp + session id
     makes ownership unambiguous.
- `.gitignore`: added `AI_TODO_*_ses_*.md` pattern so the temp
  sidecars sit safely in the working tree without polluting
  commits.
- This entry itself was shipped via the new safe-diff pattern:
  appended at the END of the numbered entries, before the
  `## Q-DEFERRED` meta section, with no edits to historical entries.

---
