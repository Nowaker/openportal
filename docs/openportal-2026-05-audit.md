# OpenPortal outstanding-work audit (2026-05)

Snapshot taken after the ULW session ending at commit `300817f` on
`main-nowaker`. Both remotes (gitlab `origin` + `github`) in sync.

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

- **5/7 archived sessions dropdown**
  CONCRETE but substantive. Sidebar component
  `apps/web/src/components/app-sidebar.tsx` (~1640 lines). Add an
  expandable "Archived (N)" group at the bottom of each project
  tree. Existing filter logic already segregates archived sessions;
  reverse the filter for the new collapsed group. The hamburger
  Archived view in `app-sidebar-nav.tsx` is the prior art for the
  data fetch.

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

`apps/web/src/routes/_app/prompts.tsx`. 6 items, multiple ambiguous.

- **Flat-mode paddings** — AMBIGUOUS. Visual diff needed against
  grouped mode.
- **Drop "opencode:" prefix** — NO MATCHES IN CODE. Searched
  `apps/web/src` for the literal string; only hits are in unrelated
  files (e.g. `server/instance/self.ts` health response key). Ask
  user for screenshot.
- **Fix load-more TODO** — CONCRETE. The "Refine the search or load
  more (TODO)." line at `apps/web/src/routes/_app/prompts.tsx:218`
  signals an unimplemented pagination feature. `data.nextCursor` is
  already on the response. Implement: `useState<PromptRow[][]>` for
  accumulated pages + load-more button + fetch with cursor + reset
  pages when query changes.
- **Markdown formatting** — `row.raw_text` is currently rendered as
  plain text inside `<div className="whitespace-pre-wrap">`. Switch
  to the existing `MessageMarkdown` component used in the chat log.
- **Export-all** — new "Download all" button + backend endpoint that
  streams the SQLite contents as NDJSON.
- **Timestamps convention** — AMBIGUOUS. Likely overlaps with the
  recently-shipped timestamp-link change (commit `a5ca342`); ask user
  for specifics.

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

4 remaining items out of 6.

- **MessageBubble + ToolCallItem wire-up to chat-display-store**
  The chat-display-store already ships per-icon visibility settings
  (chat tab > per-icon visibility grid). Consumers in MessageBubble
  + ToolCallItem need to read from the store and conditionally
  render each icon.
- **Timestamp polish** — AMBIGUOUS. Likely overlaps with the
  shipped timestamp-link change.
- **(i) info icon differentiation**
  Settings tab > Chat > Info icon already ships a `ShowInfoIconSetting`
  store + toggle. Need MessageItem + ToolCallItem to render a separate
  `(i)` icon when the setting is enabled, opening a modal with the
  full opencode message metadata (id, parts, raw event payload).
- **Backend-stored date format**
  Per AGENTS.md the canonical date format is ISO-8601 UTC. Audit
  backend route handlers for places that emit
  `Date.now()`/`toLocaleString()`/etc. instead of canonical
  `new Date().toISOString()`. Likely candidates: prompt-archive
  rows (`ts_ms` is fine as a number but human-readable serialized
  shapes may not be).
- **Year-aware timestamps** — ALREADY DELIVERED. Verified in
  `apps/web/src/lib/format-time.ts:47`: when `sameYear === false`
  the format renders `M/D/YYYY` instead of `M/D`. No further
  action needed.

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
