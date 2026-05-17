# OpenPortal outstanding-work audit (2026-05)

Refreshed at local commit `b14586c` on `main-nowaker` (2026-05-17,
after the user's audit-rebuild directive). Source: every substantive
user prompt in session `ses_019de0d38c6euLKwWoRhFZdgzg` from
2026-05-14 onward, extracted via
`~/projekty/nowaker/opencode-tools/opencode-misc-scripts/dump-user-messages.ts`
and grouped by surface.

Local commits ahead of remotes (pending explicit push auth) — newest first:

- `b14586c` settings: drop the meaningless 'Default agent' 3rd tier
- `8285866` docs: DESIGN_CONSISTENCY.md (END synthesis) + audit Settings 5/7 closure
- `484cdd1` badges: document 'Waiting for OpenCode' vs 'Queued' distinction
- `db2ae95` queued: don't short-circuit answered detection on intermediate user messages
- `7b7fc24` session-status: title-bar badge + compaction + tool-name in indicator state
- `672e46b` instances: drop server-side toLocaleString() status string
- `217a826` audit: refresh after todo strip drift + ToolCallItem + date format shipments
- `ec16261` session: ToolCallItem honors chat-display-store iconVisibility
- `178edc2` todos: read from TodoTable endpoint, not windowed message scan

(`9b2d11e` and earlier already pushed to both remotes.)

## Dropped from queue per user (2026-05-17)

- ~~Fix B~~ — user couldn't recall context; dropped.
- ~~Bug #1 stuck busy~~ — dropped.

## Headline mandates - SATISFIED

| Mandate | Source | Status |
|---|---|---|
| ANY user-facing indicator flows opencode SSE → backend in-memory state → SSE push, frontend never polls indicator endpoints | msg 2026-05-17 00:18 | `e89f528` + `8daa54c` + `c625511` + `115ae3b` |
| Portal hunts opencode forever; pending prompts survive restart; 'waiting' prompts render as normal chat messages | msg 2026-05-15 03:30 + 2026-05-16 04:46 | `5f4cd70` |
| Asset error must never happen again (bulletproof) | msg 2026-05-15 19:47 + 19:55 | already shipped via release-staging architecture: `.output-released/` promoted from `.output/` only after dev-probe green; asset-fallback middleware + 14-day retention layer |
| Portal must never break in place (release-staging) | msg 2026-05-16 04:08 + 04:12 | already shipped (see asset-fallback layer + dev-first deploy pipeline in `scripts/deploy.sh`) |
| Compaction detection + title-bar status badges for ALL indicators | msg 2026-05-17 00:18 + 00:19 | `7b7fc24` (badge + indicator-state extension); `db2ae95` (queued logic fix); `484cdd1` (two-badge docs) |
| Todo strip drift on long sessions | msg 2026-05-16 20:04 | `178edc2` |

## Settings overhaul — `apps/web/src/routes/_app/settings.tsx`

Source: msg 2026-05-15 23:42 + 2026-05-16 00:13.

| # | Item | Status |
|---|---|---|
| 1 | Drop redundant tab-subtitle paragraphs ("Customize the visual experience of the portal" etc.) | `8a8d552` |
| 2 | Auto-approve permissions UI: 2 levels (global default + per-session overrides) | `ef2bb18` |
| 3 | Default agent: drop confusing 3rd tier (`defaultAgentName`); keep just per-server + global | `b14586c` (this session) |
| 4 | New "Composer" tab grouping enter-key behaviour + auto-approve permissions. When auto-approve enabled, icon uses accent color when activated. | PENDING |
| 5 | Custom accent color: dropdown last entry = "Custom", with `#hex` input + native color picker icon | PENDING |
| 6 | Move "Live updates" out of prompt-section into "Performance". Performance also exposes the hardcoded server-side tool-output byte limit (instance-global config) + any other hardcoded knobs | PENDING (instance-settings-state already has `toolOutputMaxBytes` — wire to UI) |
| 7 | New "Chat" tab: markdown formatter, per-icon visibility per platform, hover info (mode/model/thinking effort) on desktop, link opening behaviour (new-tab/new-window/this-tab/none), expand-vs-info icon differentiation | PARTIALLY DONE: per-platform icon visibility (`9b2d11e` + `ec16261`), `(i)` info icon (`c2f82c1`). REMAINING: link opening behaviour setting + validation; hover info on desktop; markdown formatter toggle |
| 8 | New "Tools" tab section (catalog, enable/edit/reset, ordering) | PENDING (tools tab exists per `app-sidebar-nav` reference - audit current state) |
| — | `/prompts?focus=<sid>` should auto-expand the focused session (user opens it collapsed) | `18e92e3` |
| — | Prompt history filter container clip (Android Chrome narrow viewport top-pixels cropped) | PENDING — concrete repro: open `/prompts` on narrow viewport, observe filter row clip |

## Prompt history (`apps/web/src/routes/_app/prompts.tsx`)

Sources: msg 2026-05-15 23:54, 2026-05-16 00:31 + 00:32, 2026-05-16 00:38.

| Item | Status |
|---|---|
| Session title displayed for each session (not just truncated session_id) | PENDING — architecture: project_path → server_id lookup via instance registry + lazy fetch on expansion. NOT trivial; see [Prompt-archive session-title display](#prompt-archive-session-title-display) below |
| Highlight matches in search results | `79e71c1` |
| Session id should be a link | `a5ca342` (timestamp click-opens session) |
| Drop "1 day ago" relative timestamps, use canonical timestamp format with message permalink | `a5ca342` |
| Drop "Show raw" button | `809da8c` |
| Top-bar error fills space between title bar and prompt history filter | PENDING — needs concrete repro (user has screenshot) |
| Flat-mode paddings unified with chat log | PENDING — need to share styles/components per user instruction |
| Drop `opencode: Prompt history` prefix | PENDING — NO LITERAL MATCH IN CODE. User's screenshot vs current code differ; ask user to re-confirm what they see today |
| Implement load-more pagination (was TODO) | `8dedb65` |
| Markdown formatting in prompt history rows | `96530bc` (when not actively searching) |
| Export all (project + session level) | `08a8f88` (project level NDJSON, no session-level filter UI yet) |
| Hover full datetime tooltip on timestamps | PENDING — title attr present, verify formats |
| Drop "Show/Hide Error" toggle on error banner (show error always) | PENDING — see [Error banner](#error-banner) |
| `?prompts=1` invalid_value zod error when user clicks "only user prompts" filter | PENDING — fix the schema validation: accept `1`/`0` strings |

## Per-message UI — `apps/web/src/routes/_app/session/$id.tsx`

Sources: msg 2026-05-15 23:04, 2026-05-15 23:25, 2026-05-16 00:31, 2026-05-16 00:38, 2026-05-17 00:18-19.

| Item | Status |
|---|---|
| Title-bar status badge (ERROR/QUESTION/PERMISSION/COMPACTING/TOOL/THINKING/QUEUED) | `7b7fc24` |
| Per-platform icon visibility (chat-display-store) for MessageItem + ToolCallItem | `9b2d11e` + `ec16261` |
| `(i)` info icon copies message metadata to clipboard | `c2f82c1` |
| Queued badge: don't short-circuit on intermediate user messages | `db2ae95` |
| Document `Waiting for OpenCode` vs `Queued` distinction | `484cdd1` |
| Restore floating buttons (prev-user / show-all / next-user / jump-to-bottom) at bottom-right of chat | PENDING — user has full HTML snippet of what was removed; restore the cluster |
| "Waiting for OpenCode" banner styling: format like any other chat log entry (always last; chat-row indistinguishable styling otherwise) | PENDING |
| Permalink target highlight on `#msg-<id>` hash open: very-visible highlight | PARTIALLY DONE (`permalink-pulse` keyframe in main.css); verify visibility on dark/light + per-accent |
| Permalink click within chat shouldn't navigate or copy (already viewing it); just highlight | PENDING |
| Permalink right-click = copy; left-click = open (NOT click-to-copy) | PENDING — current behaviour is click-to-copy per `MessagePermalinkTimestamp` |
| Star/favorite messages → "Pinned messages" view at right burger (filters: all/this-project/this-session + text search) | PARTIALLY DONE: `StarMessageButton` + `useStarredMessagesStore` + `/starred` route exists; verify Pinned messages UI matches spec |
| Sidebar nav banner ordering: pinned sessions strip ABOVE all error banners (above title + hamburger); error banners go BELOW title bar | PARTIALLY DONE: PinnedTabStrip + AppSidebarNav placed above 3 status banners in `_app.tsx` (`29ced8c`). Verify still correct after recent commits. |
| Desktop edit-session-name button: position immediately right of title text end | `c0b0b20` (rename pencil glued to title-text end) |
| `opencode-was-updated` banner ordering above `lost-connection` (so hover-button targets don't jump) | PENDING |
| Sidebar links must include `?server=` permalink | PARTIALLY DONE (`23ae9d8` covers most; audit remaining navigate() calls) |
| Typography: OpenCode vs OpenPortal — fix all misspellings (always one or the other, never variations) | PENDING — codebase-wide audit + spelling pass |

## Server is idle false-positive (msg 2026-05-15 03:44)

User asked for Option B (graduated 3-state stall verdict). Already implemented in `$id.tsx:3064` with `silent` / `no-dispatch` / `stuck-busy` matching `DISPATCH_GRACE_MS=30s` and `STUCK_BUSY_THRESHOLD_MS=5min`. The verdict is sourced from the SSE-pushed `useSessionStatus` (Phase C of indicator broadcaster), so the false-positive root cause (`?directory=` missing on polling) is structurally gone. **VERIFIED FIXED** (no commit needed).

## Search-in-sidebar (msg 2026-05-14 21:47 + 2026-05-15 03:31)

| Item | Status |
|---|---|
| Search also matches pinned-sessions strip; hide non-matched from pinned strip | `38a8ff6` (filter + highlight pinned section by same search query) — verify still working |
| Desktop: search-as-you-type | `b7f4fdd` (incremental filter on desktop, submit-to-search on mobile) |
| Mobile: stays submit-to-search | covered by same `b7f4fdd` |

## Connection feedback (msg 2026-05-16 00:13)

| Item | Status |
|---|---|
| Frontend `console.log` informative about op/oc connection transitions | PENDING — add structured `console.info` lines on connection-monitor state changes |
| Distinguish "Lost connection to OpenPortal" vs "opencode unreachable" | PARTIALLY DONE — `ConnectionStatusBanner` + `BuildMismatchBanner` exist; audit which surfaces show "OpenPortal" vs "opencode" |
| Cached-data banner: yellow alert box when serving from cache (opencode unreachable) | PENDING — `X-OpenPortal-OpenCode-Down` header is set on stale fallback (`5f4cd70`); surface in UI |
| Prompt history + server list + settings keep working when opencode down | DONE for prompt history (own DB), server list (own state), settings (`~/.openportal-state.json`) |

## Session info modal (msg 2026-05-15 20:40)

| Item | Status |
|---|---|
| Rename "Session" to whatever opencode calls it (title?) | PENDING |
| Include session ID in modal body | PENDING (currently only in URL) |
| Fix invalid 0-values for tokens — when opencode doesn't report, say "unknown" not "0" | PENDING |
| Modal is a permalink (`#info`) | `useHashOpen("info")` already exists |

## Companion plugin (msg 2026-05-14 00:22 + 00:41 + 01:00 + 01:30)

Already substantial work shipped (auto-install button + restart detection). Status not fully tracked here; if user follows up, re-audit specifically.

## Sudo MCP / presence detection (msg 2026-05-15 23:42, fragment near end)

| Item | Status |
|---|---|
| Real presence detection on the openportal host (last browser request wins, no time window) | DONE per `~/projekty/webapps/portal/AGENTS.md` ("Network trust + presence detection" section); presence-tracker.ts + presence-tracker-hook.ts |
| dev-portal + openportal-dev.service + opencode-sandbox.slice + ~/.openportal-dev | DONE per AGENTS.md "Dev sandbox" section |
| Document sudo MCP pros/cons vs native tool | PENDING — write up the rationale (concretely: MCP chosen because needs cross-instance broadcast + browser modal fallback over tailscale) |
| Sudo dispatcher uses ONLY presence, never per-request `client.isLocal` | DONE per AGENTS.md |

## Push-to-talk (msg 2026-05-15 23:42 + fragment)

| Item | Status |
|---|---|
| VAD timeout configurable in Settings (default 5s) | PENDING |
| Animated countdown on mic icon (clock/car dial OR 5-4-3-2-1 countdown) | PENDING |
| STT result inserts at cursor position, NOT end of input | PENDING |
| Mic button click doesn't lose textarea focus | PENDING |

## Local file links + file browser (msg 2026-05-14 04:19)

| Item | Status |
|---|---|
| Local file links (`file:///`) clickable; open in side-bar file browser (desktop) / new tab (mobile) | PENDING — audit FileBrowser + MarkdownRenderer link handler |
| Right side bar resize broken: drag-left expands, drag-right doesn't shrink; mouse follows after drag stops | PENDING |

## Polling audit + general resilience (msg 2026-05-15 23:42 fragment)

| Item | Status |
|---|---|
| Audit polling: separate setting for chat streaming vs general (non-chat) streaming | PARTIALLY DONE — indicator-broadcaster eliminated `/session/status` + `/question` + `/permission` polling. Audit remaining `useSWR refreshInterval > 0` callsites |
| `last-viewed`, `permissions` no longer poll every second | DONE — `usePermissions` `refreshInterval: 0` post-Phase C |
| Prompt history loads cached data when opencode down with visible "cached" banner | PARTIALLY DONE — `getStaleMessages` fallback in `messages.ts`; need user-visible banner |
| Distinguish "OpenPortal connection" vs "opencode connection" in connection-status banner | PENDING — currently the banner says "lost connection to OpenPortal" even when only opencode is down |

## Build / restart / deploy cycle (msg 2026-05-16 01:47 + 04:08-04:12)

| Item | Status |
|---|---|
| Bundle multiple build/restart/probe tool calls into one `scripts/deploy.sh` | DONE — `scripts/deploy.sh` wraps everything |
| Dev sandbox validates before prod restart | DONE — `openportal-dev.service` at `:5001`, prod at `:5000`; deploy.sh probes dev before prod |
| `dev-portal.desktop.ts.nowaker.net` Caddy block | DONE per AGENTS.md "Dev sandbox" |

## Stuck-detector plugin consumer (msg 2026-05-17 later)

**BLOCKED on plugin shipping.** The opencode-stuck-detector plugin (at
`~/projekty/nowaker/opencode-tools/opencode-stuck-detector/`) is being
refactored to expose HTTP at `127.0.0.1:4098`. Once that lands,
openportal becomes a consumer:

1. Nitro proxy routes `apps/web/src/server/plugin/verdicts.ts`, `/verdicts/stream.ts`, `/unstuck/[sid].ts`, `/config.ts` forwarding to 127.0.0.1:4098.
2. `useVerdicts()` hook replaces `useSessionStatus` / `useQuestions` / `usePermissions` (fold their data into `VerdictState`).
3. `<StatusBadge>` already exists (`7b7fc24`); update data source to `useVerdicts`.
4. Stall-banner per-cause text + Unstick button.
5. Settings → "Stuck Recovery" pane.
6. `/stuck` route + global panel.
7. Optional: browser Notification on stuck transition.

DO NOT START until plugin's HTTP server is live.

## Prompt-archive session-title display

User wants session title in `/prompts` rows. Current architecture
(prompt-archive table at `~/.local/share/openportal/openportal.db`)
carries `session_id` + `project_path` but no title. Each prompt
belongs to ONE opencode-serve instance (multi-server portal).

Two options (audit-doc recommends 1):

1. **Sidecar table**: new `prompt_session_meta(session_id PRIMARY KEY, title, server_id, project_path, last_updated_ms)`. Write-through on session create + session rename events (capture via SSE indicator broadcaster). Cheap join in prompts list endpoint. NEEDS: DB migration + capture hooks.
2. **Lazy fetch**: project_path → server_id lookup via instance registry (each instance has `directory`); fetch `/session/{id}` from owning server. Single-file frontend change but slower per-row.

PENDING — user said this needs architecture decision; pick option 1 as part of next focused session.

## DESIGN_CONSISTENCY.md

Shipped initial draft in `8285866` (330 lines). User can review and
request iterations. PARTIALLY DONE — may need expansion for items not
yet captured (e.g., spacing rules for floating bottom-right button
cluster, banner ordering rules per `_app.tsx` invariants).

## Error banner

Source: msg 2026-05-16 00:38.

| Item | Status |
|---|---|
| Drop "Show/Hide Error" toggle - show error always | PENDING |
| Error styled consistently with chat-log alerts (per the typography mandate) | PENDING |

## Misc

| Item | Status |
|---|---|
| msg 2026-05-14 00:17 — mobile thinking effort button max-width inside icon; auto-approve icon = NOT bolt (bolt is thinking) | PENDING (small UI fix) |
| msg 2026-05-15 04:15 — openportal not aware ultraworker forces thinking strength to max; opencode UI updates after response. Reflect in openportal. | PENDING |
| msg 2026-05-15 21:33 — Fork button does nothing. Investigated (`fork.post.ts` + handler exist); needs concrete repro | PENDING (user repro needed) |
| msg 2026-05-15 20:40 — Session info modal: include session ID, fix 0-token issue, modal is permalink | PENDING |
| msg 2026-05-16 04:46 — Prompt submission broken when opencode flaky | DONE via pending-prompt durability (`5f4cd70`) |
| Cost discrepancy openportal $2620 vs opencode UI lower | PENDING — needs user clarification on which values are being compared. Probably opencode showing only one project's cost vs openportal aggregating all projects |
| Caddy dotfiles reconciliation | PENDING — needs user decision (promote dotfiles vs sync live back) |

## Truly autonomously-actionable bounded items (pick from these next)

1. **`?prompts=1` zod error** — small, concrete; just accept the string in schema.
2. **Mobile thinking-effort button max-width + auto-approve icon swap** — small UI fix.
3. **Restore floating bottom-right button cluster** — user provided HTML; reinstate.
4. **"OpenCode" / "OpenPortal" typography pass** — `grep -i 'open ?code\|open ?portal'` codebase-wide, fix misspellings.
5. **Show error banner always (drop Show/Hide toggle)** — small UI fix.
6. **Permalink click-to-open semantics** — change `MessagePermalinkTimestamp` click handler.
7. **Session info modal: include session ID, fix 0-value tokens** — concrete file edit.
8. **Permissions icon uses accent color when auto-approve enabled** — small UI fix.

## Items requiring user input (genuinely blocked)

- **"opencode:" prefix in prompt history title** — no literal match in code; need user screenshot to confirm what they see.
- **Cost discrepancy $2620** — need clarification on which UI values are being compared.
- **Caddy dotfiles reconciliation** — user decision required.
- **Fork button does nothing** — concrete repro needed.
- **Prompt history error banner glitch** — concrete repro needed.
- **Settings 7/7 filter container clip on Android Chrome narrow viewport** — user has the device + scenario.

## Migration / continuation guidance

Start with the "Truly autonomously-actionable bounded items" list
above. Each is a focused change that lands as one commit. None
depend on user input. Land them in the order listed (typography pass
last because it's the broadest).

For the larger items (Composer/Chat/Tools tabs in Settings, accent
color picker, floating button cluster, prompt-archive sidecar
migration), schedule a focused session of 2-4 hours each.

For the BLOCKED items: confirm with user as you encounter them; the
audit doc above is the single source of truth - don't reinvent the
classification.
