---
status: DONE
commit: 
session: ses_17b24b84cffedauPzCQnVF91sv
queued_at: 2026-06-01T15:23:47-05:00
legacy_number: 155
---

# Build-mismatch banner: show incoming commit subject + GitLab link

User prompt (verbatim):

> OpenPortal updated - reload to upgrade
>
> should be instead:
>
> OpenPortal updated - reload to upgrade. Incoming: [first line of git commit message, capped at X characters](link to that commit message on gitlab)

Design notes:

- Extend build metadata injected at Vite build time to include commit SHA, commit subject (first line), and GitLab commit URL.
- Expose metadata via response headers on `/api/instance/self` probe (`X-OpenPortal-Commit-*`) so an old frontend bundle can read the newer backend commit details.
- Update `useBuildMismatch()` to return structured state (`mismatched`, `incomingCommitSubject`, `incomingCommitUrl`) and update the banner UI to render `Incoming: ...` as a clickable link.
- Cap commit subject length at build time (`COMMIT_SUBJECT_MAX_CHARS`) so the banner stays compact.
