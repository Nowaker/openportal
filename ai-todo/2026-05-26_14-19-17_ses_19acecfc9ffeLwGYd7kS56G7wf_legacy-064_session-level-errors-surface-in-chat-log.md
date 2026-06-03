---
status: DONE
commit: 9ce45c7
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T14:19:17-05:00
legacy_number: 64
---

# Session-level errors surface in chat log

User prompt:

> why do i see this error badge from stuck detector, but not in the session chat log? fix that. ALL errors coming from the session surface in the chat log. i'm not asking that stuck detector stuff be shown there (it should) - but if there's any api errors or internal errors from opencode or provider, they must be surfaced on their own in the chat log, even when stuck detector is turned off or not working.

Root cause: opencode emits a `session.error` event for session-wide failures (ProviderModelNotFoundError, ProviderAuthError, etc. thrown BEFORE any assistant message gets created). `indicator-state.ts` writes that to `state.lastError` on the indicator and `session-status-badge.tsx` surfaces it as the red ERROR pill. But the chat log only renders per-message ErrorBox for assistant messages whose `info.error` is set OR whose `finish` reason is bad - which never matches a pre-message session-level error. So the user saw a tooltip on the badge with a meaningful error payload, but the chat log itself stayed empty.

Design notes (9ce45c7):
- `parseSessionLevelError(raw)` extracts a readable title + detail from opencode's `{ name, data: { message } }` envelope JSON-stringified into `indicator.lastError`. Falls back gracefully when the indicator stored a plain string instead of JSON.
- `hashSessionError(raw)` derives the acknowledge id from the error CONTENT (simple 32-bit string hash, base36-encoded). Same error string always hashes to the same id, so re-emitted errors don't re-surface after acknowledge; a genuinely new error (different text) gets a different id and re-fires the box.
- `SessionLevelErrorBox` component wraps the existing `ErrorBox`, reading `sessionIndicator.lastError`, computing the hash id, and honoring the existing `useSessionErrorStore.acknowledge` flow.
- New `useIndicator(instance?.id, sessionId)` subscription `sessionIndicatorForErrors` lifted to right before the `setSessionError` effect (kept the existing one at line 4179 untouched to minimize risk - they share the same module-level store via `useSyncExternalStore`).
- `setSessionError` effect now prefers session-level error when present (passes the hash id); falls back to the existing failed-assistant-message scan. Sidebar red dot now lights up for session-level errors too, not just message-level ones.
- Render site: `SessionLevelErrorBox` rendered immediately after `{messageNodes}` in the chat list container, so the box appears at the BOTTOM (where the user is likely scrolled when something just went wrong).
- The existing per-message ErrorBox is unchanged - assistant messages with `info.error` keep their inline red banner. The two coexist; if opencode emits both signals for the same event the user sees two boxes (inline + bottom), which is acceptable over-communication for the rarer overlap case. The much more common case is the pre-message session.error (no message exists at all), which now has the chat-log surface it needed.
