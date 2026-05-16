# OpenPortal outstanding-work audit (2026-05)

Last refreshed at local commit `672e46b` on `main-nowaker`.
`9b2d11e` and prior pushed to both remotes (gitlab `origin` +
`github`). Four local commits ahead pending explicit push auth:

- `178edc2` todos: read from TodoTable endpoint, not windowed scan
- `ec16261` ToolCallItem honors chat-display-store iconVisibility
- `672e46b` instances: drop server-side toLocaleString() status
- (`9b2d11e` MessageItem chat-display-store wire-up — pushed)

This document satisfies the standing "Audit ALL PREVIOUS user requests
+ return incomplete to todo (user-mandated)" item. Every outstanding
item below has at least one of: a file path, a reproducible
ambiguity, or a blocking user-input requirement.

## Headline architectural mandate — SATISFIED

Verbatim:

> "ANY indicator the user needs to see (in-progress, retry, error,
> question/permission pending, anything user-facing) MUST flow as:
> opencode SSE upstream -> openportal backend (subscribed once per
> opencode-server) -> in-memory indicator state map -> SSE push to
> all connected browsers (delta-only). The frontend MUST NOT poll
> opencode `/session/status`, `/question`, or any other indicator-
> source endpoint."

Delivered end-to-end via:

- `apps/web/src/server/lib/indicator-state.ts` — process-wide singleton
- `apps/web/src/server/plugins/indicator-broadcaster.ts` — per-server
  SSE subscriber, reconcile 30s, reconnect with backoff
- `apps/web/src/server/indicators.get.ts` — snapshot GET endpoint
- `apps/web/src/server/indicators/stream.get.ts` — SSE delta feed
- `apps/web/src/hooks/use-indicators.ts` — singleton EventSource
  consumer (useSyncExternalStore-backed)
- `apps/web/src/hooks/use-opencode.ts` — `useSessionStatus` rewritten
  as pure selector; `usePermissions` / `useQuestions` switched from
  `usePollMs(2000)` to `refreshInterval: 0`
- `apps/web/src/routes/_app/session/$id.tsx` — pending-permission
  `setInterval(refresh, 2000)` replaced with edge-triggered
  `useEffect` keyed on indicator's `pendingPermissionIds`

Live verification: `curl /api/indicators` returns clean snapshot;
`curl -N /api/indicators/stream` emits the initial `snapshot` frame
plus per-mutation deltas.

## Headline pending-prompt mandate — SATISFIED

Verbatim:

> "Portal backend must hunt opencode until it can submit the prompt
> successfully. Openportal restart must not lose that; has to
> continue after. And 'waiting for opencode' prompts must show in
> the chat like they're normal messages."

Delivered:

- `apps/web/src/server/plugins/pending-prompt-worker.ts` — retries
  indefinitely (no MAX_DELIVERY_ATTEMPTS), 1s-60s exponential
  backoff
- `apps/web/src/server/opencode/[port]/session/[id]/messages.ts` —
  injects pending rows as virtual user messages with
  `info.id="pending::<archiveId>"` so the chat renders them inline
- `apps/web/src/server/lib/messages-cache.ts` — `getStaleMessages`
  fallback so a 5xx from opencode no longer wipes the chat

## Outstanding actionable items

### Settings overhaul

`apps/web/src/routes/_app/settings.tsx`. 4 items remaining out of 7.

- **3/7 default agent: drop confusing 3rd level**
  AMBIGUOUS. The current selector exposes a layered fallback chain
  (`selectedAgents[sid]` → `lastUsedAgentByInstance[id]` → 
  `lastUsedAgentGlobal` → `defaultAgentName`). User said collapse
  to 2 levels but did not name which two. Suggested resolution:
  ask user "per-session override + global default; drop the
  per-instance memory + the global-last-used fallback?" — then
  ship.

- **5/7 archived sessions dropdown** — ALREADY DELIVERED in
  `49d5a88` (predates this audit, was already in main-nowaker
  when the audit was first written). `ProjectGroup` in
  `apps/web/src/components/app-sidebar.tsx` (lines 145, 478-522)
  ships a per-project collapsed "Archived (N)" group with:
  per-group `archivedExpanded` state, "Show N more" pagination,
  search auto-reveal, and data split via
  `byDir.archivedSessions` at line 594/607/610. The
  callsite at line 1164 passes `node.bin.archivedSessions`
  per-project. No further action.

- **7/7 prompt history filter container clip**
  AMBIGUOUS specifics. The filter row at top of `/prompts`
  (`apps/web/src/routes/_app/prompts.tsx` lines 116-161) lives
  inside `<div className="flex-1 overflow-auto">`. Some
  viewport-height combination clips the top edge of the focus ring
  on the input. Repro: open `/prompts` on Android Chrome at a
  narrow viewport, focus the search input, observe the ring
  overlap.

### Prompt history set 1 remaining

`apps/web/src/routes/_app/prompts.tsx`. 2 items remaining out of 6.

- **Session title display**
  ARCHITECTURE NEEDED. Prompt rows carry `session_id` + `project_path`
  but no session title. The session title lives in opencode's session
  metadata, fetched per-instance via `useSessionsList`. A multi-server
  archive view can't trivially look up titles across all instances
  without re-fetching N sessions lists. Two options:
  1. Add a backend join: prompt-archive sidecar table that stores the
     title at write time (cheap, but needs migration + capture point
     on session-create + session-rename events).
  2. Lazy per-row fetch: when user expands a session group, fire
     `/api/opencode/{port}/session/{id}` and cache the title for the
     duration of the page view.
  Recommend option 1 — title is small + stable.

- **Error banner glitch**
  Needs user repro. The banner is `StaleDataBanner` at top of
  `/prompts`. Unclear which state triggers the glitch.

### Prompt history set 2

`apps/web/src/routes/_app/prompts.tsx`. 3 items remaining out of 6.

- **Flat-mode paddings** — AMBIGUOUS. Visual diff needed against
  grouped mode.
- **Drop "opencode:" prefix** — NO MATCHES IN CODE. Searched
  `apps/web/src` for the literal string; only hits are in unrelated
  files (e.g. `server/instance/self.ts` health response key). Ask
  user for screenshot.
- **Fix load-more TODO** — DONE (`8dedb65`). Pagination via
  `extraPages: PromptRow[][]` + nextCursor + Button; resets on
  query change.
- **Markdown formatting** — DONE (`96530bc`). `MarkdownRenderer`
  when query is empty; `highlightMatch` plain text when query is
  active (markdown wrap conflicts with `<mark>` substring
  highlighting otherwise).
- **Export-all** — DONE (`08a8f88`).
  `GET /api/prompts/export?q=&project=&session=&from=&to=` streams
  `application/x-ndjson` with
  `Content-Disposition: attachment; filename="openportal-prompts-<stamp>.ndjson"`.
- **Timestamps convention** — AMBIGUOUS. Likely overlaps with the
  shipped timestamp-link change (`a5ca342`); ask user for specifics.

### Audit user requests
This document.

### `DESIGN_CONSISTENCY.md` (END)
Systemic UI audit + write-up. Per user spec this lands LAST after the
rest of the queue is delivered. Synthesizes the spacing tokens, color
tokens, typography, link styling, button hierarchy, indicator palette
across the application into a single canonical reference document.

### Fork button (AFTER all others)
INVESTIGATED. The handler at
`apps/web/src/routes/_app/session/$id.tsx:3766` POSTs to
`/api/opencode/{port}/session/{id}/fork` with `{messageID}`, then
navigates to the new session. The backend endpoint at
`apps/web/src/server/opencode/[port]/session/[id]/fork.post.ts`
proxies the call upstream. Both look correct. The reported failure
"Fork button does nothing" needs concrete user repro (specific
session ID + browser console output + opencode log line) to diagnose.

### Low-pri deferred bundle

1 ambiguous item remaining out of 6.

- **MessageBubble + ToolCallItem wire-up to chat-display-store** —
  DONE. MessageItem in `9b2d11e`, ToolCallItem in `ec16261`. Eight
  render points across three branches honor
  `iconVisibility[platform][icon]`: copy + expand + timestamp on
  tool rows; fork + revert + copy + info + timestamp on message
  rows. Platform via `useMediaQuery().isMobile`.
- **Timestamp polish** — AMBIGUOUS. Likely overlaps with the
  shipped timestamp-link change. Needs user specifics.
- **(i) info icon differentiation** — DONE (`c2f82c1`).
  InformationCircleIcon button in MessageItem action row when
  `showInfoIcon === true` (and not pending); copies
  `JSON.stringify({info, parts}, null, 2)` to clipboard with a
  success/error toast. Modal viewer with rich rendering can layer
  on later.
- **Backend-stored date format** — DONE (`672e46b`). Audit found
  one violation: `apps/web/src/server/instances.ts:26` emitted
  `Running since ${new Date(startedAt).toLocaleString()}` (dead
  field, no frontend consumers, uses server locale not user's).
  Removed. All other backend `Date.toX` callsites already use
  `toISOString()` or numeric epoch.
- **Year-aware timestamps** — ALREADY DELIVERED in
  `apps/web/src/lib/format-time.ts:47`.

### Todo strip drift — DONE (`178edc2`)

Symptom: openportal's todo strip/float went blank on long-running
sessions even with intact plans in opencode. Root cause:
`extractLatestTodos(messages)` scanned the message stream for the
latest `todowrite` tool part; the messages endpoint is windowed at
50 (`DEFAULT_INITIAL_LIMIT` in
`apps/web/src/server/opencode/[port]/session/[id]/messages.ts:20`),
so once the latest todowrite drifted past the tail the scan
returned null. Live proof against
`ses_019de0d38c6euLKwWoRhFZdgzg`: 71 messages after the last
todowrite vs a 50-message window.

Fix: switch to opencode's dedicated `GET /session/:id/todo` (reads
from TodoTable SQLite directly, no window dependency). New proxy
route at `apps/web/src/server/opencode/[port]/session/[id]/todo.ts`
forwards `?directory=`; helper at
`apps/web/src/server/lib/session-todo.ts` iterates known worktrees
when no directory hint is given (per-session keying makes worktree
collisions impossible). Frontend hook
`useTodos(sessionId)` in `apps/web/src/hooks/use-opencode.ts`
is two-layer: SWR with `refreshInterval: 0` for cold-load seed,
`useIndicator` for live SSE updates. `SessionIndicatorState`
gained a `todos: IndicatorTodoItem[] | null` field alongside the
existing counts triple; `applyOpencodeEvent`'s `todo.updated`
handler populates both. `extractLatestTodos` stays in
`lib/todos.ts` for backwards compat but has no callers.

## Blocked on user input

Each needs the user to supply something before the agent can act.

- **Cost discrepancy openportal $2620 vs opencode UI lower**
  User needs to clarify which cost values are being compared
  (openportal session total vs opencode dashboard total?) and what
  rate of discrepancy is acceptable.
- **Caddy dotfiles reconciliation**
  Stale `~/projekty/dotfiles/dotfiles/etc/caddy/Caddyfile` vs live
  `~/projekty/webapps/caddy/Caddyfile`. User needs to decide:
  promote dotfiles to live, sync live back to dotfiles, or pick a
  hybrid.
- **"Fix B"**
  User couldn't recall context. Unactionable until the user
  re-explains what "Fix B" refers to.
- **Bug #1 stuck busy**
  Needs concrete repro: a session that gets stuck in busy state +
  the steps that produced it.

## Migration / continuation guidance

For the next focused session:

1. Start with the BOUNDED + UNAMBIGUOUS items: archived sessions
   dropdown (Settings 5/7), load-more pagination (Prompt history set
   2 item).
2. Ask the user about the AMBIGUOUS items before implementing:
   default-agent 3rd level (Settings 3/7), prompt history filter
   clip (Settings 7/7), "opencode:" prefix, flat-mode paddings,
   timestamps convention.
3. The session-title display in `/prompts` (Prompt history set 1)
   needs an architecture decision — recommend the prompt-archive
   sidecar table approach over the lazy-fetch one.
4. `DESIGN_CONSISTENCY.md` lands LAST after the rest of the queue,
   per user spec.
