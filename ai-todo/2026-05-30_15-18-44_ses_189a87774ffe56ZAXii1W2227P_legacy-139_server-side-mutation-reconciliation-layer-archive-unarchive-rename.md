---
status: DONE
session: ses_189a87774ffe56ZAXii1W2227P
queued_at: 2026-05-30T15:18:44-05:00
legacy_number: 139
commits:
  attributed:
    - 9d0be864d6c0
  on_main:
    - 9d0be864d6c0
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Server-side mutation reconciliation layer (archive, unarchive, rename)

User prompt (verbatim):

> remember that opencode api is slow. openportal should act as inprogress queue / reconnciliation method. if openportal gets archive request, then any subsequent data sent by openportal should start reporting this session as archived in an extrafield that will be interpreted instead if it exists, e.g. archived=false from oc, and archivedProgress=true. openportal ui reads both and always reacts to archiveXXX field as prioritized one.  actions are saved as inprogress on openportal backend side. because portal frontend always talks to portal backend to talk to opencode api, there is always this caching layer available. create an architecture for it, that other parts of the system will also use. implement session rename using that method to, also unarchive [note: burger -> unarchive -> no confirm needed, do right away]
>
> implement on a worktree, integrate to main branch when done.

Design notes:

- Full design: `ai-analysis-requests/MUTATION_RECONCILIATION_ARCHITECTURE.md`.
- Server-side overlay store in `apps/web/src/server/lib/session-overlay.ts` keyed `port:sessionId`. Pending fields prefixed `_pending*` so the shape stays distinguishable from opencode's authoritative fields.
- `apps/web/src/server/opencode/[port]/sessions.ts` applies overlay onto every session before returning and reconciles (clears overlay entries opencode has caught up on).
- Mutation endpoints (`archive.post.ts`, `unarchive.post.ts`, `index.patch.ts`) set overlay synchronously BEFORE awaiting the slow opencode call, then call `invalidateSessionsCache(port)` so the next /sessions GET re-fetches with the overlay applied. On opencode failure the overlay rolls back.
- Frontend reads via `effectiveArchivedAt(s)` / `effectiveTitle(s)` from `apps/web/src/lib/session-overlay.ts` - never the raw `time.archived` / `title`. Sidebar + nav updated.
- `useArchiveSession` / `useUnarchiveSession` in `apps/web/src/hooks/use-opencode.ts` simplified - client-side optimistic SWR patch (#138) replaced by a plain `mutate(key)` revalidate after success, since the server overlay handles the optimistic part now.
- Burger Unarchive: drop confirmation dialog, fire immediately - same as burger Archive. Sidebar-row Unarchive keeps existing behaviour (icon-only, no confirm), session-row Archive keeps confirm (high misclick risk surface).
- Future fields that should follow the same pattern (out of scope for v1): `_pendingDeleted`, `_pendingMovedTo`, `_pendingPinned`.

Files:

- `apps/web/src/server/lib/session-overlay.ts` (new)
- `apps/web/src/server/opencode/[port]/sessions.ts` (apply overlay + reconcile)
- `apps/web/src/server/opencode/[port]/session/[id]/archive.post.ts`
- `apps/web/src/server/opencode/[port]/session/[id]/unarchive.post.ts`
- `apps/web/src/server/opencode/[port]/session/[id]/index.patch.ts`
- `apps/web/src/lib/session-overlay.ts` (new)
- `apps/web/src/components/app-sidebar.tsx`
- `apps/web/src/components/app-sidebar-nav.tsx`
- `apps/web/src/hooks/use-opencode.ts`
