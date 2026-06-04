---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T20:16:21-05:00
legacy_number: 60
commits:
  attributed:
    - 2d506bc2dbcf
  on_main:
    - 2d506bc2dbcf
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# P1 cohort registry + sidebar partitioning

User prompt (P1 from cohort-architecture dispatch):

> NEW CONCEPT: instance vs server (cohort). Today /servers conflates 'running opencode process' with 'logical server group'. Split the vocabulary: Instance = single opencode-serve process. Identified by <host>:<port>. Server (cohort) = logical group of instances sharing the same SQLite DB. One PRIMARY (user-picked, used for default operations like /messages routing when ownership doesn't apply), rest are SECONDARY (used for failover, SSE subscriptions, sidebar-stats aggregation). Owner = the instance within a cohort currently holding the live runner for a given session.

Design notes:
- 2d506bc: new apps/web/src/server/lib/cohort-registry.ts polls plugin GET /workers every 30s, parses each worker {workerID, instanceUrl, lastSeen} into typed CohortWorker with parsed host+port. Exposed via getCohortSnapshot() + new Nitro plugin cohort-poller.ts that starts the loop on server boot. New GET /api/cohort endpoint returns the snapshot for frontend consumers.
- d5d2eeb: new apps/web/src/stores/cohort-store.ts SWR hook + sidebar-system-stats.tsx partitions opencodeProcesses into 'cohort×N' (matching ports in cohort) + 'other ocs×M' (different cohorts on host - sandbox-local, docker, ad-hoc). Sidebar-stats cohort metric no longer inflated by unrelated opencode-serve instances per user spec.
- Remaining P1 items (deferred for explicit scope direction): /servers UI redesign (cohort grouping + primary selector), routing abstraction (cohort handle instead of instance URL), instance/server/cohort vocabulary refactor.
