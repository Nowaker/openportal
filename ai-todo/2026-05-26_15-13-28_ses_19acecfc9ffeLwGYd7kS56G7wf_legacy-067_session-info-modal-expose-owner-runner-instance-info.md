---
status: DONE
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T15:13:28-05:00
legacy_number: 67
commits:
  attributed:
    - 6b5e4c7b9264
  on_main:
    - 6b5e4c7b9264
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Session info modal: expose owner/runner instance info

User prompt (verbatim):

> in session info modal, expose information about the owner/runner of that session. the instance that claims that owns the dispatch of it.

Design notes:
- Cohort-registry plus stuck-detector plugin's `/verdicts/<sid>` are the authoritative sources for "which opencode instance owns this session right now". `apps/web/src/server/lib/prompt-routing.ts` already resolves the owner instance URL per session (2fa0d94); same data should be surfaced in the Session Info modal.
- New `Field` rows in the modal: **Owner instance** (host:port from verdict.owner_instance_url, or "—" when verdict has no owner) and **Cohort** (which configured server the owner instance belongs to, derived from the cohort-registry snapshot).
- Loading state per Diagnostics protocol: render `<Loader />` until the verdict + cohort fetches resolve; show "(no runner)" rather than spinner if the verdict authoritatively reports no current runner.
- Don't add a NEW API endpoint; reuse the existing `/api/cohort` (`d5d2eeb`) and the existing stuck-detector probe endpoint that frontend already calls. New owner-info field on `/api/instance/self` is also fine if needed.
- Backend invariant: when the plugin is unreachable, fall back to the user-selected active-server URL with a "(plugin offline; showing active server)" label so the field is never blank.
