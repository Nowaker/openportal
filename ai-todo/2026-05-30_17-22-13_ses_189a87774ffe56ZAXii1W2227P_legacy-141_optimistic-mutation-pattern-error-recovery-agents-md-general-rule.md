---
status: DONE
commit: b3ef800
session: ses_189a87774ffe56ZAXii1W2227P
queued_at: 2026-05-30T17:22:13-05:00
legacy_number: 141
---

# Optimistic mutation pattern + error recovery + AGENTS.md general rule

User prompt (verbatim):

> 1 s delay between modifying the field and actually seeing the change.
> if form is waiting to be successfully submitted to the portal backend, then it's not how it should work.
> if wait -> spinner/indicator something. AGENTS MD IS CLEAR ABOUT IT.
> if apply immediately -> cool, can close the form and make it reflect new value right away BUT if backend responds with error 2 seconds later, the value must be reverted in all places, plus indicator of error, maybe a tiny ! in triangle on the right of edit icon, and on mouse over / on tap, show brief error message.
> this is an ultimate general rule for the project. IF WAIT FOR BACKEND -> MUST INDICATE THAT. if error later, must recover from it.
>
> and update agents.md to make it clearer, all pf those prinicples

Design notes:

- Generalizes the optimistic mutation pattern from #139 / #140 into a binding project rule documented in AGENTS.md "Optimistic mutations + reconciliation overlay" section.
- Three-layer pattern: (1) server-side overlay, (2) frontend resolver, (3) originating-tab optimistic SWR patch + rollback + error indicator. EVERY mutating user action must follow it.
- Error recovery contract: rollback the optimistic patch on failure, write a `MutationError` to `apps/web/src/stores/mutation-errors-store.ts` keyed by sessionId, render `<MutationErrorIndicator sessionId={id} />` from `apps/web/src/components/mutation-error-indicator.tsx` adjacent to the affected control (small warning triangle with `title` / `aria-label` for the message).
- New per-mutation error store: `apps/web/src/stores/mutation-errors-store.ts` exports `useMutationErrorStore` + `useMutationError(sessionId)`.
- Applied to: rename (`submitEditTitle` in `app-sidebar-nav.tsx`), archive (`useArchiveSession`), unarchive (`useUnarchiveSession`) in `apps/web/src/hooks/use-opencode.ts`. Error indicators rendered in topbar (next to rename pencil) + active sidebar rows (next to archive icon) + archived sidebar rows (next to unarchive icon).
- AGENTS.md update covers: the three layers, error recovery contract, when-to-apply table (sub-100ms / 100ms-3s / multi-second), extension points for future surfaces (delete / move / pin / star / etc.).

Files:

- `AGENTS.md` (new section "Optimistic mutations + reconciliation overlay (binding)")
- `apps/web/src/stores/mutation-errors-store.ts` (new)
- `apps/web/src/components/mutation-error-indicator.tsx` (new)
- `apps/web/src/hooks/use-opencode.ts` (archive + unarchive optimistic + rollback + error)
- `apps/web/src/components/app-sidebar-nav.tsx` (rename optimistic + rollback + error + indicator render)
- `apps/web/src/components/app-sidebar.tsx` (indicator render on active + archived rows)
