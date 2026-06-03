---
status: DONE
commit: 1b4402d
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:50:32-05:00
legacy_number: 37
---

# Error display in chat log: red box -> gray on Acknowledge

User prompt (sent in the same message as #36):

> Enqueue:
>
> Unknown error
> Acknowledge
> {"type":"invalid_request_error","message":"Output blocked by content filtering policy"}
>
>
> These errors go in a box in chat log
> It's red. Once acknowledged, its borders and text should be more like gray. It was a problem but isn't any more.

Design notes:
- Extracted the in-chat error block into a new `ErrorBox` component in `routes/_app/session/$id.tsx`. Reads `useSessionErrorStore.acknowledged[sessionId]` and toggles its border / background / text colors:
  - Active: `border-danger/40 bg-danger-subtle/30 text-danger-subtle-fg`
  - Acknowledged: `border-border/60 bg-muted/30 text-muted-fg`
- The `Acknowledge` control (button → "Acknowledged" pill via `ErrorAcknowledgeControl`) stays at the same right-aligned position; only the outer box recolors.
- `isLastError` gating preserved: only the most recent error message in the session shows the Acknowledge control. Acknowledging older errors via the sidebar bell still works the same way.
