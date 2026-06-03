---
status: DONE
commit: 2a357a2
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T12:09:55-05:00
legacy_number: 44
---

# Sidebar workspace refresh: 60s auto-rescan + per-workspace refresh button

User prompt:

> next: directory structure on the sidebar should refresh for new directories every once in a while. watcher? or rescan? make it perform well. introduce refresh button on the far right side of each workspace in sidebar (here ~/projekty and ~/sync/owncloud/virtkick-private/dreamhost)

User clarification follow-up:

> you mean only new folders in ~/projekty will show up, but not in subdirs?

Design notes:
- `useProjectPaths()` (`use-opencode.ts`): SWR refreshInterval 60_000 + `revalidateOnFocus: true`. Cheap bounded `readdir` per configured workspace; depth bounded by `level` + `level1` config. ~16 readdirs total per cycle; no long-lived `fs.watch` handles (avoid handle leakage on the slow OwnCloud-sync mount).
- New refresh button per workspace at the far right of each `WorkspaceHeader` in `app-sidebar.tsx`; mutates the SWR key for an instant rescan + spins the icon for visual feedback.
- Clarification: yes, only the workspace TOP-LEVEL gets the auto-rescan. Subdir changes inside an existing project don't propagate via this loop — they would require fs.watch, deferred.
