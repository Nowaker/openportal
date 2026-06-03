---
status: ARCHIVE
commit:
session: ses_unknown
queued_at: 2024-01-01T00:00:00-05:00
legacy_number: 0
---

# Legacy AI_TODO.md preamble (archived)

The following block was the header of the legacy `AI_TODO.md` file before its per-entry migration. It captured cross-cutting context: explicit cancellations (calls the user made to NEVER reopen certain topics), standing rules now codified in `AGENTS.md`, and a roll-up of completed themes with their canonical commit hashes. Preserved verbatim for historical reference; superseded for active queue use by the per-entry files in this directory.

---

# AI TODO

Comprehensive refresh of `ses_1ad6a8e07ffeUN4nLbC0vax6d0` ("Portal development"), regenerated from a **full sweep over the entire session** — 568 substantive user prompts across **24 compactions** from 2026-04-28 17:29 UTC through 2026-05-22 23:26 UTC, cross-referenced with 429 portal commits and the user's full conversation history (including prompts that pre-dated multiple compaction handoffs and may have been compacted away from the AI's live working memory).

Method:
1. Dump of all 568 surviving user prompts via `~/projekty/nowaker/opencode-tools/dump-user-messages.ts` (slash-cmd-aware after commit `9af22ab`).
2. Cross-reference with `git log --since='2026-04-28'` on this repo (429 commits) — every theme below names the commit(s) that closed it where applicable.
3. Explicit-cancellation sweep for "skip / remove from todo / forget / never put back / drop from todo" patterns.
4. Permalink-rule sweep — that's a session-spanning constraint the user reiterates often.

Each PENDING item below lists at least one verbatim user prompt that motivated it. Each COMPLETED theme lists the canonical commit(s).

This file supersedes AI_TODO_BEFORE_COMPACTION.md (which only captured the last handoff's worth of prompts).

---

## EXPLICIT CANCELLATIONS (the user told us NOT to do these — keep off the list permanently)

These are calls the user made INSIDE the session telling us to skip or remove items. They MUST NOT reappear in future todos.

- **"Project rename" (final/last)** — `remove from todo "Project rename (last)" nd never put it back again` (msg_e5295c442, 2026-05-13). The user explicitly forbids ever bringing back the "rename opencode-named OpenPortal project" task.
- **opencode upstream PR for `GET /mcp/{name}/tools`** — `remove from todo "opencode upstream PR for GET /mcp/{name}/tools" and never put it back again` (msg_e5295c44e, 2026-05-13). Don't reopen.
- **Rotation feature (whatever it was)** — `skip rotation. remove from your todo.` (msg_e5295a73e, 2026-05-11). Whatever "rotation" meant in that earlier context, drop it.
- **Fix B, Bug #1 stuck busy** — `Fix B, Bug #1 stuck busy - drop from todo.` Already deferred per the user.
- **"Phone app opens last conversation as slide-up"** — `Sorry, forget "Todo+= phone app on opening opens the last conversation slide up. Stupid, don't. Then, when opening a convo, open it in full view, not a slide up" it was meant for a different session.` (msg_e52959e47, 2026-05-02). Not for this repo.
- **Bug-report-then-self-resolved** — `actually, form works ok. it's me. i didn't know i have to make a selection for form to activate.` (msg_e52957e44, 2026-04-29). The "answer form is inactive" report was user error.

---

## STANDING RULES THE USER ESTABLISHED IN-SESSION (now in AGENTS.md or actively enforced)

These are not pending items but RULES the user added by prompt that the next session should honor. All have made it into `AGENTS.md` files where applicable:

- **"Everything is a permalink"** — every non-trivial UI state must round-trip through the URL (settings tab, modal, file-browser path+file, message highlight, server selection, etc.). Codified at the portal AGENTS.md `Everything is a permalink (URL-driven UI state)` section. Many prompts reiterate this; the rule still has follow-up items (see PENDING #7 / #11 / #12 below).
- **TODO ordering rules** — adding a new prompt while work is running ENQUEUES (default: end). Position keywords `add`/`next`/`now`/`immediately`/`before X` decide placement. Don't drop the in-progress item. Codified at `~/.config/opencode/AGENTS.md` § "Todo list discipline".
- **Non-trivial Q-items** — when the user asks an open-ended question, answer + append a deferred Q-id todo (Q1, Q2, ...). User explicitly added this rule in-session.
- **Restart hygiene** — "you restart openportal when changes are needed. not me. do it every time." (msg_e52958b81). Codified in portal AGENTS.md.
- **`scripts/deploy.sh` is the canonical build path** — never call `bun run build` directly (asset-retention rule, see portal AGENTS.md "Build -> restart -> commit cycle").
- **Async-action feedback (mandatory)** — every user-initiated server round-trip must show progress IMMEDIATELY. The user repeated this rule in many forms ("draft only gets cleared when status went to 'sent to opencode' (openportal already had it, why fucking wait..."). Codified at portal AGENTS.md "Async-action feedback (mandatory)".
- **NEVER restart user-managed opencode** — `~/.config/opencode/AGENTS.md` / portal AGENTS.md — the user enforces this constantly.
- **Plugin install posture** — stuck-detector plugin install is portal's responsibility; ONLY portal calls the install endpoint; plugin file is the only writer to its config.
- **Optimizations must not degrade features** — "if a transfer-reduction patch turns a live-updating control into something the user has to click to load, that patch is a regression."

---

## COMPLETED THEMES (with canonical commits)

Most of the 568 prompts collapse into themes whose work is now landed. Listed so they don't get re-asked:

### Sidebar tree
Indicators cascade through all levels; final-level matches upper-level; sort by indicator-presence first then activity; search auto-reveals; ctrl+K distinguishes subsessions; workspace-dir headers replace "Projects" label with compact path.
Landed: `2a25573`, `00c00e4`, `c1876c7`, `feda670`, `9a963ac`, plus ~10 polish commits.

### Pinned tabs
Cross-device pinned list, drag-drop reorder, status indicators, X-always-visible, padding iterations.
Landed: `9a963ac` (cross-device), `feda670` (drag-drop reorder), `9ced3e8` (banner polish), plus polish commits.

### Notifications
Browser notifications on session-done / question / error; router-nav (no full reload); first-load permission banner; permission-denied banner with unblock instructions; cross-tab dedup via BroadcastChannel; sound effects 1:1 with opencode web UI.
Landed: `1c8df0e`, `c18ba7b`, `986dbdd`, `fed987e` Section J, `f11d454`.

### Image attachments
In-app modal preview, blob caching, thumbnails, backdrop opacity iterations.
Landed: `e040230` (modal), `8260b8d` (thumbnails), `2ea70b1` (blob-cache), `c8cef8c` (warm-blob-cache script), `709c96a`/`6f86a63`/`d19d8e1` (backdrop iterations).

### Composer / drafts / cross-tab / voice STT
Drafts in localStorage with cross-tab BroadcastChannel sync; image attachments persist as drafts; ctrl+enter submit; STT push-to-talk vs VAD; auto-submit configurable (default off); picker bar split left/right on desktop.
Landed: `e56f3e9` + `2e56cf2` (drafts), `17ba322` (cross-tab broadcast), `030bc13` (STT auto-submit + premature-flush fix), voice-stt service vendor commits, `deb60b8` (picker-bar split).

### MCP / plugin / LSP listings
Full info modal, on/off toggles, single-line layout, markdown rendering, info icon, on-click NOT closing menu, LSP list below MCPs.
Landed: `5e58df8` (Session Info + 5-state slider), `793044b` (5-state color visualization), `f556e49` (MCP OAuth handshake via web UI), polish commits.

### File browser
Path-aware address bar, `#` icon for root, project-dir icon, in-place editing with sandboxed write, per-extension icons, language detection, top-bar polish, recent/mentions/bookmarks dropdowns.
Landed: `472bed3`, `177e865`, `446eeb9`, `5a0b565`, `ec97c30`, `b12e44c`, `003a695`, `6ffe469`, `e7203b0`.

### Connection resilience + asset reload
Build-id header for stale-bundle detection, reconnecting banner, SWR refetch on reconnect, PTR, openportal-survives-opencode-disconnect.
Landed: `36108f4`, `b0295d0` (external-opencode resilience + web-wrapper.mjs), `305ed4c` (PTR), `eb408e2` (Reload button visibility), plus the 3-layer asset-fallback architecture documented in portal AGENTS.md.

### externalOpencode lifecycle mode
"No spawning" mode that connects to existing opencode by port + probes /config/providers.
Landed: `a44b131`.

### Rename session
Pencil icon next to title, inline input + check/X.
Landed: `c914a7f`, `c2d1952`.

### Auto-approve permissions
Toggle icon in composer, per-session override, settings list with title shown.
Landed: `e4a84a9`, `c8db6ab`, `153441d`, `04ee545`, `b737fe6`, `8fc7189`, `a0ceb47`.

### Compaction
Feature in hamburger menu, persistent "Compacting..." indicator at bottom of chat log, /summarize 400 bug fix (wire providerID/modelID).
Landed: `102c1b5`, `d112074`, `33e12e9`, `db50c5d`, `6ad7328`, `8fc7189` (banner).

### Fork
Button left of revert on every message, router-nav to new session, mobile-tight ForkIcon, subagent fork dropdown (child / parent-at-spawn / parent-at-finish).
Landed: `417a381`, `8da6857`, `8195cc6`, `1710e6e`.

### Stuck-detector incorporation (Sections A-K — the 19-section directive of msg_e52974654)
ALL landed:
- Section A: `a792eb6`
- Section B: `f59cbff`
- Section C: `fbed1de`
- Section D: `45c146b`
- Section E: `63692e9`
- Section F bug #1: `e0ab89d`
- Section G: `4b519f1`
- Section H: `8fa649f`
- Section I (3 parts): `f921619`, `2fd7ad9`, `5452c74`
- Section J: `fed987e`
- Section K: `eee7932`

### Settings tabs structure
8-tab structure (Appearance / Prompt / Composer / Chat / Tools / Content / Performance / Diagnostics); date/time format; theme/accent; replaced upstream API tab with Diagnostics; chat tab fix (missing TabPanel).
Landed: `c671d8d` (Diagnostics replaces API), `8fa649f` (Performance + Content split), `443900f` (drop subtitle, back-button icon-only), `bba69a5` (chat tab fix).

### Permalink coverage (foundational)
Active session, active server (`?server=`), settings tabs (`#tab-id`), message permalinks (`#msg-id`) with smart-window loader, Session Info modal (`#info`).
Landed: `useHashOpen` hook + smart-window loader + per-route hash whitelists.

### Diagnostics tab
pid, uptime, runtime, platform, state-file paths/sizes, providers/models, sessions count, other portals on host, browser info, client preferences.
Landed: `c671d8d`.

### Tilde-completion popover
When word starts with `~`, completion popover for files/dirs relative to home.
Landed: `14a0925` (file-mention: dual-trigger - support ~ for home-relative completion).

### Session-info modal
Stats parity with opencode web UI (total tokens from LAST assistant; context-usage % math fix; per-bucket Context Breakdown bar).
Landed: `fcc4710`.

### Error acknowledge
Button only on LAST error in chat log; render disabled "Acknowledged" state once clicked.
Landed: `0bcc477`, `d71ca5b`.

### Diagnostics field stripping (the multi-MB diagnostics fix)
Strip whole `state.metadata.diagnostics` map on tool-part responses (model never reads them; saved 13.57 MB on the kotlin-heavy session).
Landed: `4978e52` (initial fixes-only strip), `f0bc04b` (full strip — 95.8% reduction).

### Hamburger > Compact action 400 bug
"Hamburger > compact threw 400 immediately" — wire providerID/modelID to /summarize.
Landed: `33e12e9`.

### Sidebar system stats
Real CPU% via delta sampling, iowait, disk indicator, Current vs All-opencodes split, integer no-decimal, TB unit jump, label polish.
Landed: `a2eec13`, `c7df6cd`, `530af83`, `d7360a8`.

### Title-bar context-dial → session info
Click context-fullness indicator opens Session Info modal; Android back closes hamburger.
Landed: `0b8cbcb`.

### Diagnostics LSP-output stripping verified
The diagnostics+LSP wire-bloat fix above is part of this same theme. ✓

### VS Code link
Open project dir in VS Code; per-requestor path mapping for remote clients.
Landed: `0be1285`, `1c65167`.

### Other tangents (out of portal scope — DONE elsewhere or N/A)
- "Codenomad start" (msg_e5295873d) — operational, not portal work.
- "LibreChat IAC" (msg_e5295a6f8) — operational, not portal work.
- "OpenChamber deploy" (msg_e5295c963) — separate repo, not portal work.
- "image-dim-cap plugin stdout interference" (msg_e5295e0ac) — opencode-tools repo, not portal.
- "MCP perplexity URL fix" (msg_e52967fbb) — MCP config, not portal.

---

## PENDING (genuine remaining work, ordered by priority + size)
