---
status: DONE
commit: 65f2e85
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T01:28:13-05:00
legacy_number: 23
---

# Systemctl restart alert vanishes too fast

User prompt:

> systemctl restart via alert box doesn't work. it showed me error but before i could read it disappeared. (wtf, it can't disappear just because) you are running inside tailscale instance so inspect against a different instance so your work doesn't get interrupted if it succeeds.

Design notes (65f2e85):
- Root cause: the OpenCode-restart popover in `_app.tsx` rendered the result text inline; the popover closes on outside-click (React Aria default), losing the inline error if the user clicked elsewhere after seeing it.
- Fix: `doRestart` now calls `logSystemMessage('restart', ...)` on every outcome (success / HTTP-error / network-error), mirroring the companion-telemetry-panel pattern that was already in place for the OTHER restart surface. Audit trail survives popover-close + page navigation since the system-messages drawer holds the durable record (last 200 events, localStorage-persisted at `openportal-system-messages-v1`).
- The success path keeps its 2500ms auto-close timer (correct behavior — success is informational), but the success is also logged so the user can see "restarted X at HH:MM" later if they want to audit.
- AGENTS.md restart-hygiene rule honored: AI is forbidden from restarting `opencode-serve-tailscale` (this session's runtime) — that's only ever a user-initiated action through this popover.
