---
status: DONE
session: ses_17b24b84cffedauPzCQnVF91sv
queued_at: 2026-06-01T16:51:57-05:00
legacy_number: 156
commits:
  attributed:
    - 179bcf19a4fe
  on_main:
    - 179bcf19a4fe
  reverted: false
verdict: present
verdict_reason: "Commit 179bcf1 on main: 'app: drop commit-url header from upgrade metadata'. X-OpenPortal-Commit-Url no longer present anywhere in apps/web/ (rg confirms zero matches)"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Remove X-OpenPortal-Commit-Url header; derive URL from commit SHA

User prompt (verbatim):

> X-OpenPortal-Commit-Url
>
> really needed? commit urls are based on commit shas anyway?
> fix if true.

Design notes:

- Remove redundant `X-OpenPortal-Commit-Url` response header and associated build-time define.
- Keep `X-OpenPortal-Commit-Sha` + `X-OpenPortal-Commit-Subject`; derive URL client-side from canonical GitLab commit base URL + SHA.
- Preserve existing banner UX (`Incoming: <subject>` as a clickable link), with no behavior regression.
