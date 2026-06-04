---
status: PENDING
session: ses_189a87774ffe56ZAXii1W2227P
queued_at: 2026-05-30T04:50:02-05:00
legacy_number: 138
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Archive/unarchive must invalidate sessions SWR cache

User prompt (verbatim):

> doesn't appear working as specified. archiving doesn't cause the session on the navbar to go to archived section.

Design notes:

- Root cause: `useArchiveSession` / `useUnarchiveSession` in `apps/web/src/hooks/use-opencode.ts` fired the API but never told SWR to refresh `/api/opencode/<port>/sessions`. The navbar reads `time.archived` from the cached sessions list to bucket rows; without invalidation it keeps showing the pre-archive layout until the next opportunistic poll/focus event.
- Fix: in both hooks, optimistically patch the cached sessions list (set `time.archived` to `Date.now()` on archive, delete it on unarchive) via `useSWRConfig().mutate(key, updater, { revalidate: false })`, then revalidate after the API call. On error, revalidate to roll back to server truth.
- Net effect: the archived row jumps into the archived subsection on the same click; the auto-expand effect added in #134 keeps it visible because it is now the current session.
- Files: `apps/web/src/hooks/use-opencode.ts`.
