# Prompt submission state machine

Captures the full flow from the user pressing Send to the assistant's
reply landing in the chat. Each state, what it means, when it fires,
and what the user sees.

## States

The optimistic-message store carries a `_pending.phase` field on user
messages. Two values exist today (`apps/web/src/hooks/use-session-messages.ts:40`):

```typescript
phase?: "submitting" | "opencode-accepted";
```

After `opencode-accepted` the optimistic row is **replaced** by the
real message from opencode's SSE event stream - the badge disappears
because the row no longer has `_pending`. So there are effectively
three observable visual stages:

1. `phase === "submitting"`
2. `phase === "opencode-accepted"`
3. (badge gone; assistant generation in flight or already done)

## Stage 1: `submitting`

**When it fires**: The instant the user presses Send.
`handleSubmit()` at `apps/web/src/routes/_app/session/$id.tsx:4133`
runs and calls `addOptimisticMessage()` at line 4293 with the
new message pre-stamped with `phase: "submitting"` (line 4268).
The user-message row appears in the chat immediately.

**What's happening internally**:
- The composer textarea is locked (button disabled, focus
  preserved per the post-c084f12 smart-clear).
- The composer's draft store gets cleared (cross-tab
  BroadcastChannel `opencode-composer-sync` fires).
- A POST to `/api/opencode/<port>/session/<id>/prompt` is in flight.
- openportal HAS NOT yet heard back from opencode.

**Visible to the user**:
- The user-row renders with `bg-accent/25` (light) / `dark:bg-accent/20`
  (dark) per the recent visibility bump.
- A small blue badge above the message body reads "Submitting"
  with a spinning <Loader/> icon. The badge uses the lighter blue
  variant (border-blue-300/40, bg-blue-300/15).
- attempts counter appends "- N attempts" if the retry path has
  kicked in.

**Exit condition**: One of three:
- HTTP 200 from opencode -> transition to `opencode-accepted`.
- HTTP 4xx/5xx -> badge persists with `lastError` populated; the
  outer queue worker retries.
- Network failure -> same as HTTP 5xx.

## Stage 2: `opencode-accepted`

**When it fires**: The fetch() to opencode resolved with a 200
response, BEFORE the SSE stream has delivered the real
message.created event. This is the window where opencode says
"yes I got it" but hasn't yet finalised the user message id +
returned it through the event channel.

Hit at `apps/web/src/routes/_app/session/$id.tsx:4432`.

**What's happening internally**:
- The optimistic row's `_pending.phase` is patched in place via
  `updateOptimisticMessage()`. The row stays optimistic - it
  doesn't get replaced yet.
- A `toast.success` may fire if `recoveredFromRestart` is true
  (the stuck-detector-bridge marker).
- The composer's smart-clear pass runs (clears submitted text,
  preserves anything the user typed during the round-trip).

**Visible to the user**:
- The badge text flips to "Sent to OpenCode".
- The badge color deepens: border-blue-500/40, bg-blue-500/15.
  The deeper blue communicates "we got further in the flow".
- Loader icon still spinning - assistant hasn't replied yet.

**Exit condition**: The SSE `message.created` event for the new
user-message ID arrives. The optimistic row is removed and
replaced by the real message row from the SWR cache (which has
no `_pending`). Badge disappears.

## Stage 3: (assistant generation in flight)

**When it fires**: After the optimistic user message is replaced
by the real one. From this point opencode is generating the
assistant reply.

**What's happening internally**:
- `isAssistantBusy` (line 3189) flips true. Driven by the
  session.status SSE event from opencode (busy / retry / idle).
- The indicator broadcaster (`apps/web/src/server/lib/indicator-state.ts`)
  pushes the busy state to ALL connected tabs.
- The Stop button (red X) appears in the composer chrome.

**Visible to the user**:
- No "Submitting" / "Sent to OpenCode" badge - the row is now a
  normal user message.
- A "Thinking..." indicator + staleness clock appears BELOW the
  user message (driven by `<ThinkingStaleness messages={messages} />`
  at line 1525).
- The composer's submit button is hidden / replaced by the
  Stop button (`isAssistantBusy ? "Queue message" : "Send"`).
- Sticky-bottom kicks in: if the user was already at the
  bottom, the view follows new content. If they scrolled up,
  the view stays put.
- Status-badge in the title bar shows "THINKING" / "TOOL: X" /
  "QUESTION" / "PERMISSION" / "COMPACTING" per the
  pickBadge() priority chain.

**Tool runs**: If the assistant fires a tool, the title-bar
badge swaps to "TOOL: <name>" + the chat row shows the tool
call. The assistant CAN make several tool calls in one turn -
the badge updates per the latest in-flight tool. When the tool
completes, opencode emits message.part.updated with the result.

**Permission asks**: If a tool needs explicit user permission
AND auto-approve is off (or disabled for this session), the
title-bar badge becomes "PERMISSION" + the chat row shows the
permission prompt. The user replies via the UI; openportal
posts to `/api/opencode/<port>/permission/<id>/reply`.

**Questions**: If the assistant asks the user a question
(opencode's `question.asked` event), the title-bar badge
becomes "QUESTION" + a yellow question banner appears in the
chat. Reply via the UI fires `/api/opencode/<port>/session/<id>/
question-answer`.

## Stage 4: idle

**When it fires**: opencode emits `session.idle` (or its session
falls off the session.status map - both signals work). The
assistant message has `time.completed` set.

**What's happening internally**:
- `isAssistantBusy` flips false.
- The TTS auto-trigger (if enabled in Settings) speaks the
  assistant's text.
- The notification-sounds path (if enabled) plays the
  turn-complete sound.
- The OS-level browser Notification fires (if permission
  granted + tab not focused).
- Status-badge clears.

**Visible to the user**:
- No more "Thinking..." indicator.
- Submit button returns; Stop button gone.
- The assistant's complete message body is rendered.
- If TTS enabled: audio playback starts.
- If notification permission granted: bell sound + OS toast.

## Visual cheat sheet (composer button)

In addition to the per-message badge, the COMPOSER submit button
itself has a phase indicator for STT countdown (independent of
the prompt-submission state machine):

- Idle: PlayIcon (send arrow).
- STT push-to-talk grace window active: digit "5..1" countdown
  on the submit button itself (`sttCountdownDigit` derivation at
  line 3327). Pulses + tabular-nums for stability.
- assistant-busy: aria-label flips to "Queue message" - the
  button still works, it just queues the prompt for after the
  current turn.

## Cross-tab synchronisation

All of the above flows broadcast via:
- `opencode-composer-sync` BroadcastChannel (cross-tab composer
  clear on submit).
- SSE `/api/indicators/stream` (cross-tab status / question /
  permission state).
- Per-session `localStorage["opencode-pending-prompt:<sid>"]`
  safety net (rehydrates if the submit fetch was silently
  dropped on a tab close mid-submit).

## Where to look in code

| Stage | Code path |
|---|---|
| Phase 1 stamp | `$id.tsx:4263-4269` (addOptimisticMessage) |
| Phase 2 stamp | `$id.tsx:4425-4434` (after fetch resolves) |
| Badge render | `$id.tsx:2385-2410` |
| isAssistantBusy compute | `$id.tsx:3189-3253` |
| Thinking indicator | `$id.tsx:1524-1539` (ThinkingStaleness) |
| Status badge priority chain | `apps/web/src/components/session-status-badge.tsx:35-95` |
| SSE event stream | `apps/web/src/server/lib/indicator-broadcaster.ts` |
| TTS auto-trigger | `$id.tsx` useEffect watching messages |
| Notification sounds | `apps/web/src/stores/notification-sound-store.ts` |
