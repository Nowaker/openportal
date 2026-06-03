---
status: DONE
commit: 24a22c5
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T02:22:11-05:00
legacy_number: 29
---

# Archived sessions: composer disabled-but-visible + centered placeholder + Unarchive button

User prompt:

> Enqueue to the end: archived sessions should have all controls on the bottom visible but disabled. Input field should say, align center and vertical center accordingly. And have a button below to unarchive.

Design notes:
- When the active session has `time.archived > 0`, the entire composer (prompt textarea + send button + agent / model / thinking pickers + attach + voice + auto-approve toggle + todo strip) stays VISIBLE but is DISABLED. No layout shift between active and archived views — same chrome, same controls, just non-interactive.
- The prompt textarea displays a centered placeholder (text and vertical alignment both centered) explaining the session is archived. Suggested copy: "This session is archived. Unarchive it to send new prompts." or similar — match it to the Unarchive action label.
- A new "Unarchive session" button renders below the composer (or in a banner just above it — pick whichever fits the existing layout best). Click reuses the existing /unarchive endpoint + ConfirmDialog flow from Section N (so the same code path exercises both entry points).
- Visual cue: subtle muted overlay or tint on the composer area to reinforce the disabled state, without making the controls invisible.
