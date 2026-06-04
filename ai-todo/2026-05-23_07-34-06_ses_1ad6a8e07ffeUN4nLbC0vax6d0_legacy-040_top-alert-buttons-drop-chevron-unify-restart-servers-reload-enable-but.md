---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T07:34:06-05:00
legacy_number: 40
commits:
  attributed:
    - b3e95973d93c
  on_main:
    - b3e95973d93c
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Top alert buttons: drop ^ chevron + unify Restart/Servers/Reload/Enable button sizes

User prompt:

> Enqueue:
> Even if error message can be collapsed/expanded. Let's remove the ^ thingie on the right for consistency. "restart opencode" -> restart. Servers button isn't the same size as restart buttons. All buttons in these alerts up top must be same size, style etc

Design notes:
- `CompactBanner` (`apps/web/src/components/ui/compact-banner.tsx`): remove the rotating `ChevronDownIcon` entirely. The message text itself is still the click target when details are present (`aria-expanded` on the message button preserves keyboard a11y); expand/collapse still works, just doesn't advertise itself with a chevron.
- "Restart OpenCode" → "Restart" (label change in `RestartOpencodeButton` in `_app.tsx`).
- All four top-alert action buttons (Restart, Servers Link, Reload in BuildMismatchBanner, Enable in NotificationPermissionBanner) converge on the same className: `inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted`.
- All icons become `size-3.5` (previously a mix of `size-3` and `size-3.5`).
