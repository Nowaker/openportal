---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T02:22:11-05:00
legacy_number: 29
commits:
  attributed:
    - 68d9ede38328
  on_main:
    - 68d9ede38328
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Archived-session UX: visible-but-disabled controls + centered Unarchive

User prompt:

> archived sessions should have all controls on the bottom visible but disabled. Input field should say, align center and vertical center accordingly. And have a button below to unarchive.

Design notes:
- An archived session (`session.time?.archived > 0`) renders the composer's bottom controls (mode/agent/model/thinking/todo/auto-approve/attach/voice/send/etc.) in VISIBLE BUT DISABLED state. Don't hide them. The grayed-out bar is the visual signal "this is read-only".
- The text input field replaces its placeholder with a centered (horizontal + vertical) notice. Suggested copy: "This session is archived. Unarchive to continue."
- Below the input field: a single prominent button "Unarchive session" that calls the existing `/api/opencode/[port]/session/[id]/unarchive` endpoint (shipped in Section N / commit 661d1e7).
- After successful unarchive: SWR mutate sessions list so the composer returns to its enabled state on next render.
- Apply the visible-but-disabled pattern uniformly: any composer control that would mutate session state must respect the archived flag; controls that are pure UI (mode/agent picker readouts) can stay interactive if they don't trigger session writes.
