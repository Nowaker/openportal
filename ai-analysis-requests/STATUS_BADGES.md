# Status badges & dots — full inventory + reality check

User report (2026-05-23): the yellow "in progress" badge has not been
seen for many days. User asked for a complete inventory of every
badge in the system, what each is documented to do, and a verdict on
whether that documented behaviour actually fires in practice.

## Two distinct badge systems

OpenPortal has **two** distinct visual indicators that share some
vocabulary but live in different files, render in different places,
and read from different sources. Confusing on first look but the
split is real.

### System A: `SessionStatusBadge` (chip with text)

Source: [`apps/web/src/components/session-status-badge.tsx`](../apps/web/src/components/session-status-badge.tsx).

Rendered in: title bar of the active session view (top of chat).
Pinned-tab "TOOL: bash" hover label uses the same `pickBadge` logic.

Reads from: SSE indicator stream via `useIndicator(serverId, sessionId)`.
The stream comes off `/api/indicators/stream`, which is hydrated by
the **indicator broadcaster** (server plugin at
[`apps/web/src/server/plugins/indicator-broadcaster.ts`](../apps/web/src/server/plugins/indicator-broadcaster.ts)).

### System B: `SessionStatusDot` (colored dot, no text)

Source: [`apps/web/src/lib/session-indicators.tsx`](../apps/web/src/lib/session-indicators.tsx).

Rendered in: sidebar session rows, pinned-tab dots, sidebar-rail
collapsed layout dots.

Reads from: a separate `SessionStatusMap` that is itself derived from
the SAME SSE indicator stream via `useSessionStatus()` in
`apps/web/src/hooks/use-opencode.ts:136`. So while the rendering is
distinct, the source-of-truth is the same indicator broadcaster.

## System A: SessionStatusBadge — full vocabulary

`pickBadge(state)` runs a priority chain top-to-bottom. First match
wins; once a badge fires the lower-priority ones never render even
if their state also matches.

| Priority | Kind | Label | Color | When |
|---|---|---|---|---|
| 1 | `error` | `ERROR` | `bg-danger` (red, no pulse) | `state.lastError` non-null |
| 2 | `question` | `QUESTION` | `bg-sky-500` + `animate-pulse` | `state.pendingQuestionIds.length > 0` |
| 3 | `permission` | `PERMISSION` | `bg-sky-500` + `animate-pulse` | `state.pendingPermissionIds.length > 0` |
| 4 | `compacting` | `COMPACTING` | `bg-violet-500` + `animate-pulse` | `state.mode === "compaction"` |
| 5 | `tool` | `TOOL: <name>` | `bg-warning` (yellow) + `animate-pulse` | `state.currentToolName && state.busy` |
| 6 | `thinking` | `THINKING` | `bg-warning` (yellow) + `animate-pulse` | `state.busy` (and no tool active) |
| 7 | `queued` | `QUEUED` | `bg-muted` (gray) | `state.pendingPromptIds.length > 0` |
| -- | (none) | nothing renders | -- | otherwise |

## System B: SessionStatusDot — full vocabulary

`SessionStatusDot` takes `{ status, hasNewContent, hasQuestion,
hasError, hasChildBusy, reserveSpace?, subagent? }` and runs its own
priority chain.

| Priority | When | Color | Pulse |
|---|---|---|---|
| 1 | `hasError` | red (`bg-red-500`) | no |
| 2 | `hasQuestion` | sky (`bg-sky-500`) | yes |
| 3 | `status === "busy"` (non-subagent) | amber (`bg-amber-500`) | yes |
| 3 | `status === "busy"` (subagent) | violet (`bg-violet-500`) | yes |
| 4 | `status === "retry"` (non-subagent) | amber-600 | no |
| 4 | `status === "retry"` (subagent) | violet-600 | no |
| 5 | `hasChildBusy` (no own busy state) | violet (`bg-violet-500`) | yes |
| 6 | `hasNewContent` (top-level only) | violet (`bg-violet-500`) | no |
| -- | `reserveSpace=true` and nothing matches | invisible spacer | -- |
| -- | `reserveSpace=false` and nothing matches | renders nothing | -- |

Subagent rule: if `subagent=true`, the busy/retry colors swap from
amber to violet to match the parent's "child running" indicator,
making the running state read as one continuous signal across the
parent + its children.

## How `state.busy` is supposed to flip

`apps/web/src/server/lib/indicator-state.ts`:

| Line | Event from opencode | Effect |
|---|---|---|
| 222-232 | `session.status` with `time.completed` falsy | `busy = true`, `idle = false` |
| 222-232 | `session.status` with `time.completed` truthy | `busy = false`, `idle = true` |
| 234-237 | `session.idle` | `busy = false`, `idle = true` |
| 238-248 | `session.error` | `busy = false`, sets `lastError` |
| 339-349 | `message.created` (role=assistant, completed falsy) | `busy = true` + `inFlightAssistantId` set |
| 367-374 | `message.updated` (in-flight assistant completes) | `busy = false`, clears `inFlightAssistantId` |
| 516-521 | `addPendingPromptId` (queued state) | `busy = true` |

## REALITY CHECK — runtime evidence

Direct probe against prod (`100.105.229.19:5000`):

```
$ timeout 2 curl -sS -N http://100.105.229.19:5000/api/indicators/stream
data: {"type":"snapshot","sessions":[]}
```

The initial frame sent to every browser tab on connect is the snapshot
of `sessionMap` from `indicator-state.ts`. **It is empty.** Zero
sessions tracked. This means:

1. Every `useIndicator(serverId, sessionId)` call returns `null`
   because the session isn't in the map.
2. `pickBadge(null)` returns `null` (first line of `pickBadge`).
3. **No SessionStatusBadge renders for any session.** Not THINKING,
   not TOOL, not QUESTION, not ERROR. None.
4. `useSessionStatus` derives from the same empty map, so every
   session reads as `idle` in the sidebar dots.

## WHY the map is empty — secondary finding

`/tmp/portal-portal-main.log` since the last restart (1566815 →
current PID):

```
[pending-prompt-worker] starting
[auto-approve-worker] connecting server=srv-2dy1srwz -> http://100.105.229.19:4096/event
[auto-approve-worker] connecting server=srv-9myqtdk1 -> http://192.168.10.10:4096/event
```

The broadcaster plugin emits two log lines on a healthy startup
(`apps/web/src/server/plugins/indicator-broadcaster.ts:272` +
`:173`):

```
[indicator-broadcaster] starting
[indicator-broadcaster] connecting server=<id> port=<port> -> http://<host>:<port>/event
```

`grep "indicator-broadcaster" /tmp/portal-portal-main.log` returns
**zero matches** across the entire log file, spanning ~2000+ lines
and multiple restart cycles. The plugin is either:

  a. not being loaded by Nitro at all (file under
     `server/plugins/` should be auto-included; if it isn't, this is
     a config or build-pipeline regression),
  b. loading but throwing before the first `console.log` fires
     (would still appear in the bundle but silently die), or
  c. the file is being tree-shaken / dropped during the build
     because something about its import shape stopped matching
     Nitro's plugin auto-discovery.

Other plugins in the same directory (`auto-approve-worker.ts`,
`stuck-detector-client.ts`, `stuck-detector-journal-client.ts`,
`session-prefetcher.ts`, `presence-tracker-hook.ts`,
`pending-prompt-worker.ts`, `companion-plugin-watcher.ts`) all log
their startup. Only `indicator-broadcaster` is silent. So the
ambient cause is specific to this one file, not a global plugin
loader failure.

## Direct consequence for the user's report

> "the yellow one. I've not seen it for many days."

The THINKING badge (yellow, priority 6) requires `state.busy = true`
to fire. `state.busy` cannot be true if the session isn't in the
indicator map. The indicator map is empty because the broadcaster
isn't writing to it. Therefore the THINKING badge cannot fire —
**not just rarely, but at all**, for every session, in every tab.

Same for TOOL: the badge needs `state.busy && state.currentToolName`.
Same prerequisite, same broken pipe.

Same for QUEUED, COMPACTING, QUESTION, PERMISSION at the badge
layer (the dot layer has independent paths for QUESTION + ERROR via
SWR-fetched `questions` and per-session error store, which is why
the SIDEBAR DOTS for question + error still work even with the
broadcaster dead).

## Behaviour that probably still works

- **Sidebar question dot** (sky pulse) — pulls from `useQuestions()`
  SWR cache, independent of indicator broadcaster.
- **Sidebar error dot** (red) — pulls from `useSessionErrorStore`
  (client-side store), independent.
- **Sidebar new-content dot** (violet steady) — derives from
  `session.time.updated` vs last-viewed timestamp, independent.
- **Sidebar draft pencil** — reads localStorage directly,
  independent.

## Behaviour that does NOT work right now

- Every `SessionStatusBadge` chip in the title bar.
- The `busy` and `retry` dots in the sidebar (amber pulse, amber
  solid) — both gated on `useSessionStatus` which is empty.
- The "child busy" dot (violet pulse on a parent whose subagent is
  running) — same gating.
- Any consumer that reads `useIndicator()` or `useIndicators()`
  for live state (todo strip badge counts, compaction mode label,
  etc.).

Side-finding: `SessionStatusMap` declares `type: "busy" | "retry" |
"idle"` (use-opencode.ts:127) but `toStatus()` only ever emits `"busy"
| "idle"` (line 132). The `"retry"` color in `SessionStatusDot` is
dead code regardless of the broadcaster issue —
`apps/web/src/hooks/use-opencode.ts:121-126` already documents this
as deliberate behaviour ("retry no longer surfaces") but the dot
component still branches on it.

## Decision points (for the user)

User explicitly said "do not fix". Surfaced findings for the user to
direct next steps. Likely fix paths:

1. **Investigate why indicator-broadcaster is not loading**:
   compare its `definePlugin` shape against the other plugins that
   DO log, check for a build-time exclusion, possibly add tracing
   `console.log` BEFORE the `definePlugin` call to see if the module
   even parses.
2. **Remove the dead `"retry"` branch** from `SessionStatusDot` OR
   restore retry classification in `toStatus()`.
3. **Smoke test** for badge visibility: a Playwright trace of "send a
   prompt, observe THINKING badge appearing" would catch this
   regression on every deploy if added to a smoke-test suite.

## Files of record

- [Badge chip](../apps/web/src/components/session-status-badge.tsx)
- [Status dot](../apps/web/src/lib/session-indicators.tsx)
- [Indicator state](../apps/web/src/server/lib/indicator-state.ts)
- [Indicator broadcaster (silent)](../apps/web/src/server/plugins/indicator-broadcaster.ts)
- [`useIndicator` hook](../apps/web/src/hooks/use-indicators.ts)
- [Session status map (lossy `retry` type)](../apps/web/src/hooks/use-opencode.ts)
