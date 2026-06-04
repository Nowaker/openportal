---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:36:57-05:00
legacy_number: 35
commits:
  attributed:
    - beaa1e1fbef9
  on_main:
    - beaa1e1fbef9
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Expose ^K (open session) as button in left sidebar under 'Open directory'

User prompt:

> Enqueue:
> Expose ^K feature in left side bar under open directory. Name it open session.

Design notes:
- Lifted Cmd component's local `isOpen` state into `useCmdStore` (zustand) at `apps/web/src/stores/cmd-store.ts`. Exposes `isOpen`, `open()`, `close()`, `setOpen(v)`. The existing `CommandMenu` keyboard shortcut handler keeps firing on Ctrl/Cmd+K — it just calls the same `onOpenChange` the button calls.
- New `SidebarItem` in `apps/web/src/components/app-sidebar.tsx` sits directly under "Open directory" in the SidebarSection. Labelled "Open session", tooltipped "Open session (Ctrl/Cmd+K)", uses `ChatBubbleLeftIcon` (reads as "pick a conversation"). Click calls `useCmdStore.getState().open()`.
- Mobile auto-closes the sidebar drawer via `setIsOpenOnMobile(false)` on click.
