---
status: DONE
commit: 1184ed5
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T13:48:15-05:00
legacy_number: 49
---

# Todo-strip: tap-again-closes (toggle behavior fix)

User prompt:

> Enqueue after current: Todo bar on mobile: clicking it first, opens the window. Cool. Clicking the todo bar again closes and immediately shows the big todo again. It should be more of a toggle if I click on it. Behavior request Applies to desktop too but I don't know if the issue happens there too.

Design notes:
- Race fix in `todo-strip.tsx`: backdrop changed from `onPointerDown={onClose}` to `onClick={onClose}`. With `onPointerDown`, the close fires BEFORE the click event completes; the click then targets the strip button (now visible behind the closed popup) and reopens. With `onClick`, the close + reopen-click are mutually exclusive — clicking the backdrop closes only, clicking the strip toggles.
- Popup body `onClick={e => e.stopPropagation()}` so clicks inside the popup don't bubble to the backdrop.
- Same fix applies on desktop and mobile (the original was a global pointerdown handler, not mobile-specific).
