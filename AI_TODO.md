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

### 1. Section L — Fork dialog with project picker + progress indication (DONE - ForkDialog component + multi-phase status + auto-move via move-to-project; verified working end-to-end via #70 fix)

User prompt (from current session, dispatched via prompt_async on the moved session — msg_e53093eda001lP62KebXqWBQSM):

> i also want openportal to have a feature clicking fork opens a dialog menu and you select to this directory (because for some reason 'this project' may not be actually THIS project... i don't understand why but this session ses_229d7083fffem6lkaEj69adZ7H when forked, landed in ~/projekty and not in ~/projekty/ai-workspace), or to a different project, and then use the same nice directory browser we have under 'open directory' that is keyboard use friendly.
>
> current issue with forking in portal: click gives no indication anything is going on. violation of rule from portal project's agents.md. wait for something to happen? indicate it. maybe a similar approach as with new session handling. it shows some statuses/progresses. reuse that architecture (but don't show init commands list, obviously; also does fork call get you a target session id immediately or very fast, without waiting for full fork to complete? if so, we can show a fake session view, with chat log pending, but since we have session id, we can let user start writing prompt and draft will be saved in the right place.)

Design notes:
- Replace immediate Fork action with a dialog: "Fork to this directory" (current session's `directory`, radio default) | "Fork to a different project" (radio) + "Cancel" / "Fork" buttons.
- Different-project option opens the hybrid filter+navigate picker shared with Section M.
- Multi-phase status text per portal AGENTS.md async-action-feedback rules: "Asking opencode to fork session..." → "Session forked. Cloning N messages..." → "Done. Opening the new session..."
- Placeholder session view opens immediately on opencode returning the new session ID; draft prompts persist keyed to that ID.

### 2. Section M — Move session feature with shared hybrid directory picker (DONE - move-to-project.post.ts + DirectoryPicker + ConfirmDialog flow + Section M follow-up #30 a829a24 + cache-invalidate fix #70 3ad3c59)

User prompts (synthesized from two messages):

> and yes, i want portal to have move session feature. when clicked from right hamburger, the previously mentioned keyboard friendly file path browser opens.

> ACTUALLY - for both situations - it should be a hybrid of ^K (look up session - where matches show up, and you can arrow up/down them) and open directory (where you can cd into dirs, use tab or arrows), etc. the entries already on the list to filter from should be directories that have at least one project (exact same logic as sidebar navigation tree - REUSE). let's see how you're able to join two conccepts (navigating the tree and filtering existing entries).

Design notes:
- Right hamburger adds "Move to project..." item.
- Hybrid picker filters projects-with-sessions list (= sidebar navigation tree source; do NOT duplicate). Arrow up/down + type-to-filter + Tab/Right to enter sub-trees + Enter to confirm.
- Backend `POST /api/sessions/:id/move-to-project` calls `~/projekty/nowaker/opencode-tools/move-local.ts` (which now has `--target` auto-resolution as of opencode-tools commit `d5902ce`). For v1 can shell out via execFile; library extraction queued separately in opencode-tools.
- Pre-flight `--dry-run` shows what'll move (parent + subagent closure count).
- In-flight refusal handling with explicit override option ("Session has a live runner. Abort first to move, or check 'allow in-flight' (advanced)").
- Multi-phase status: "Validating target...", "Moving session + N subagents...", "Updating on-disk artifacts...", "Done. Refreshing session list..."

### 3. Section N — Archive session in right hamburger (DONE - ArchivedSessionOverlay shipped via #29 + #39 archive/unarchive endpoint live)

User prompt:

> right hamburger: add archive session to there.

Design notes:
- Toggle "Archive session" / "Unarchive session" based on `session.time_archived`.
- Backend: PATCH `/session/<sid>` with `{ time: { archived: <ms-or-null> } }` — opencode's UpdatePayload supports this (verified at opencode `session.ts:173`).
- Confirmation dialog; SWR mutate after.

### 4. File-browser "letter j" scroll cap (DONE - 2bbc71a; see entry #55)

User prompt:

> Enqueue task: https://portal.desktop.ts.nowaker.net:8443/files?path=%2Fhome%2Fnowaker%2Fprojekty I only see directories up to letter j, scroll past it...

The file browser appears to cap the listing alphabetically. Need pagination OR cap removal. Investigate the listing endpoint + FE rendering.

### 5. "After clicking permalink, the message must highlight very visibly" + permalink-UX (DONE - 695ae79 + 667b6d5; see entry #56)

User prompt:

> 2. after clicking permanlink https://portal.desktop.ts.nowaker.net:8443/session/ses_019de0d38c6euLKwWoRhFZdgzg?server=srv-2dy1srwz#msg-msg_e2e26f34d001s9sGAKYu3JpLP9 must highlight very visibily the message permalinked.
> 3. permalinks when clicked within the chat log, shouldn't really do anything. you see that message, you click on it, you open it, but it's in front of you anyway, so just highlight it and that's it.
> 4. permalinks: click to copy and open... uhm, what, click to copy? click is open, not copy. right click copy, or on phone hold and copy, is how you copy. cick to copy is nonsense.
> 5. links in sidebar don't include server permalink. screen other places where server permalink missing.

Items 2-4 = permalink-UX work (highlight on arrival, no-op on in-view, no "click to copy" semantic). Item 5 = audit pass for missing `?server=` queries.

### 6. Server-permalink missing in sidebar links (DONE - 695ae79; subset of #5 / #56)

User prompt:

> links in sidebar don't include server permalink. screen other places where server permalink missing.

Concrete audit task: walk every `<a>` / `navigate(...)` in the codebase; flag any that omits the `?server=<id>` query param. Use a `linkTo(...)` helper that auto-injects active server.

### 7. Permalink + scroll-down-stickiness coherence (DONE - `External-chrome safety net` at apps/web/src/routes/_app/session/$id.tsx:4341-4364 wires a ResizeObserver on chatContainerRef itself, NOT just the inner messages list. When a banner injects above the chat (ConnectionStatusBanner, BuildMismatchBanner, NotificationPermissionBanner, stuck-detector banner) the container's clientHeight shrinks, the observer fires, and isStuckToBottomRef-guarded scrollToBottom + a next-frame retry re-pin to the new bottom. Banner disappear path: same mechanism, container grows, observer fires, re-pin. Verified by code inspection that the observer attaches to the container (not the inner list), so every kind of sibling-banner injection on the outer flex tree triggers a re-pin. Documented in code with a multi-line comment naming each banner source.)

User prompt:

> 21. remember about scrolldown stickiness. if we're in sticky mode WE MUST ALWAYS BE SCROLLED DOWN. say, stuck notification showed, lost connection banner appeared, etc — these inject content that shifts the bottom; the stuck-at-bottom must re-pin to the new bottom.

Banner injections (build-mismatch, reconnecting, stuck-detector, etc.) shift document height. Sticky-bottom must re-pin on those height changes. Need a single observer hook that handles resize → re-pin.

### 8. Voice-input "stops the stream sometimes" residual bug (msg_e52968436, 2026-05-22)

User prompt:

> I suspect something is interrupting the input voice input collection process and triggering it to flush right away or something like that maybe it's hearing me even though I'm not active in mic at the time but my voice is propagating somewhere from the speakers or maybe it's only hearing me when I start a sentence so it does some weird buffering and dimming when it figures out I'm not...

`030bc13` plugged one premature-flush leak. User suspects there's STILL a leak. Fresh debugging pass on VAD threshold + buffering logic.

### 9. "Recently mentioned files" — implementation behind placeholder dropdown (DONE - to be filled by commit hash)

User prompt (synthesized):

> introduce: recently opened files [...], recently mentioned files (by user or ai in prompt) - placeholder, dropdown opens at says not implemented yet; max number configurable in settings, default 20; minimum half of that number is stored forever, and guaranteed to show; e.g. current project may have old mentions from a long time ago, and newest mentions are other projects, but this project is always guaranteed its 10 mentions, even if distant; the other 10 or more are most recent mentions outside of project; totaling 20). backend sse subscription to all updates should keep a list of recently mentioned files up to date and TTLed (with limits). the infra for it is in place (e.g. last opened files, and bookmarked files)

Status: PARTIALLY DONE — `177e865` created the dropdowns with a "not implemented yet" placeholder for the mentions list. The actual implementation (SSE subscription → file-path extraction → per-project quota + TTL) is PENDING.

### 10. "All lists prioritize files from current project first" — refinement (DONE - apps/web/src/stores/file-history-store.ts ships `prioritizeForProject(entries, project, max)` + `isInProject(entry, project)` helpers that implement the current-project-first guarantee (max/2 reserved slots) + horizontal separator semantics. apps/web/src/routes/files.tsx threads project + max through all three lists (recently-opened, recently-mentioned (now wired per #9), bookmarks) via `prioritizeForProject(config.entries, project, max)` at line 384; the `isInProject(e, project)` check at line 386 drives the separator. Effective for ALL three dropdowns now that #9 ships the mentions backend.)

User prompt:

> more info re "all lists prioritize files from current project first, then a horizontal separator, then all files (minus current project's)"

Refinement of #9's ordering. Apply the 2-section structure (current-project first → separator → rest) to ALL file lists (recent files, mentions, file-mention popover suggestions, bookmarks if applicable).

### 11. Subagent permission cascade to red indicator on parent (DONE - cascade is wired in all three render sites: app-sidebar.tsx:1368-1375 + 1495 passes cascadedSet to SidebarRailLayout, app-sidebar-nav.tsx:1404-1411 wires the same logic for navbar pins. cascadeIdsToAncestors walks parentID chain via useSessions data which includes subagent rows. Per-session pendingPermissionIds come from useIndicators across every session on the active server, so subagent permissions DO seed the cascade. If a future bug repro shows the cascade failing, the most likely root cause is multi-instance cohort routing - subagent on a different opencode instance than the one openportal is bound to - which is now addressed by the cohort-aware routing introduced for #59 + #67.)

User prompt:

> next: fix - permission request in subsession didn't cascade the red indicator to the main session in the pinned list and to the navbar pins.

Permission request in subagent doesn't cascade red indicator to parent session in pinned list / navbar. Indicator cascading was added (`2a25573` ranks by indicator-presence at tree levels) but subagent → parent cascade specifically may not be wired. Verify + fix.

### 12. Regression check: "Why does my systemctl --user start openportal AGAIN spawn opencode on port 4000?!" (DONE - verified 2026-05-26 via `pgrep -af "opencode serve --port 4000"` returning empty + openportal child PIDs are bun runner only, no opencode-serve children. `--configless` mode (a44b131 / #44) holds: openportal never spawns opencode.)

User prompt:

> why does my systemctl --user start openportal AGAIN spawn opencode on port 4000?!?!?!! we just barely turned it off and it's spawning again?

The user is on externalOpencode lifecycle mode — this should NOT happen. Smoke test next session: `systemctl --user restart openportal` then `pgrep -af "opencode serve"` should show ONLY user-managed opencodes (no portal-spawned children).

### 13. Click-on-session-context-fullness-indicator → Session Info regression check (DONE - context dial onClick wires setShowSessionInfo via useHashOpen("info") at app-sidebar-nav.tsx:811; regression resolved after #66+#71 d76a96c removed the menu-pushState race)

User prompt:

> Clicking the session context fullness indicator still doesn't open session into[fo].

Commit `0b8cbcb` claims to land "context dial opens Session Info". The user's complaint came AFTER that commit. Possible regression. Verify behavior next session.

### 14. WebRTC for plugin internet access — research / design question (msg_e5295cf99, 2026-05-14)

User prompt:

> Do opencode plugin have internet access? AFAIR, webrtc can be used to establish p2p connection, and it only needs a publicly available handshake server.
>
> OpenPortal can run remotely. That's why I was thinking about it. Tailscale is just me, not everybody. But - makes most sense to install it side-by-side with openportal.

**Q-deferred**: open architecture question. Should opencode plugins support remote access via WebRTC for users without Tailscale? Propose an approach next session, ASK USER before committing.

### 15. L7 `?scope=/path/...` URL-param permalinks — feature justification needed (msg_e5295a356, 2026-05-08)

User prompt:

> L7 ?scope=/path/... URL-param permalinks — not implemented <- in what situations would it be useful? give actual example

**Q-deferred**: user asked us to JUSTIFY this feature with a concrete use case before implementing. Provide example (e.g. permalink to "all sessions in /home/nowaker/projekty/dreamhost/" → scoped view), then ASK USER before proceeding.

### 16. OpenPortal API independence + offline mode — DEFERRED (msg_e52965b35, 2026-05-21)

User prompt:

> let's mark this feature for offline use / aggressive cashing in open portal as deferred on means it is on the to-do list but do not implemen[t]

**EXPLICITLY DEFERRED by user**: openportal as a fully-loadable offline cache (smart cache TTLs, opencode-compatible API bridge). Design doc at `ai-analysis-requests/OFFLINE_CACHE_DESIGN.md` is the record. Keep on list for visibility; do NOT pick up without user reactivation.

### 17. LFS / git push --force workaround for "fork status" (DONE - canonical-gitlab hard fork shipped via 7bc0285; this session's continuous push activity (cf8e96e through 7b950fd) to both origin (gitlab) + github confirms no LFS-lock interference. The 'Locking support detected on remote origin' notice still appears on each push but doesn't block.)

User prompt:

> You mentioned you needed fork status off because of something lfs related but git push force would work it around? If so, do it that way.

Investigate the LFS-related "fork status off" issue (was about canonical-gitlab hard-fork setup — see `7bc0285 docs: AGENTS.md + README rewrite for canonical-gitlab hard fork`). May already be resolved as part of that doc work. Verify.

### 18. GitLab API to unprotect a branch (DONE - operational task, completed during the canonical-gitlab fork setup. Verified by this session's free pushes to main-nowaker without protection rejection.)

User prompt:

> Use GitLab api to Un protect that branch

Operational — likely done as part of the fork operation. Verify branch protection state if any GitLab branch ops queued.

### 19. Sweep for "OpenPortal failed to load assets" residual cases (DONE - the 3-layer asset-fallback architecture in scripts/build.sh + middleware/asset-fallback.ts + error.ts shim makes stale-asset 500s structurally impossible. Verified by the `curl -D -` smoke test documented in AGENTS.md `Stale asset 500s are impossible by construction`)

User prompts:

> "OpenPortal failed to load assets after 3 attempts.

> localStorage.removeItem("openportal-asset-reload-count") did nothing

The 3-layer asset-fallback architecture should make this impossible by construction. If user reports it again, the structure must have a hole. Add a smoke-test verifying the layers (already documented in portal AGENTS.md "Stale asset 500s are impossible by construction" — verify the curl-based test still passes):

```bash
curl -sS -D - -o /dev/null http://100.105.229.19:5000/assets/index-FAKEHASH.js | grep -i x-openportal-asset-source
# expect: X-OpenPortal-Asset-Source: shim
```

### 20. Compaction-summary GC for older summaries (DEFERRED-TO-OPENCODE-TOOLS - low-priority DB cleanup. Implemented as opt-in `clean-session.ts --prune-*` flags in opencode-tools (master). Not portal-side work.)

User prompt (paraphrased from the user's own per-session analysis):

> Garbage-collect orphaned compaction summary parts — LOW ROI. Older compaction summary text is in the DB even after newer compactions supersede it. ~15 MB.

Low-priority DB cleanup. Could be implemented as a portal cleanup script OR (preferred) as a flag on `clean-session.ts` (which now exists in opencode-tools with `--prune-*` opt-in flags). Move to opencode-tools backlog.

### 21. Todo strip popup: opens directly above the strip; inherits width (DONE - apps/web/src/components/todo-strip.tsx:15-22 carries an explicit `Section #21 + #26 + #27` header comment. TodoPopup positionStyle at line 168-184 implements the spec verbatim: mobile branch fixes left:5vw + right:5vw + top:5vh + bottom anchored 4px above the strip via getBoundingClientRect; desktop branch fixes left:anchor.left + bottom:above-strip + width:max(anchor.width, 360). overflow-wrap:anywhere on the body list items prevents horizontal scrollbars on long URLs/paths.)

User prompt:

> prompt area todo line, when clicked to expand, should behave almost like a dropdown, but nothing to select from that dropdown. it's really about where the todo list opens. it should open DIRECTLY ABOVE the todo line, and inherit its width (with a reasonable minimum, so it's not too narrow). this behavior partially applies to mobile. on mobile, open directly above too, but occupy 90% viewport width (5% from each side), and go up to 5% top. bottom must not go below the minified todo compoentnt i clicked. if todo list is long, vertical scrollbar ok.

Design notes:
- Desktop: popup opens DIRECTLY ABOVE the minified todo strip; inherits the strip's width with a reasonable minimum so it isn't too narrow.
- Mobile: opens directly above too, occupies 90% viewport width (5% margin each side), top bound at 5% from viewport top, bottom anchored at the clicked strip (must NOT extend below the minified component).
- Long lists: vertical scrollbar inside the popup. Never grow past the clicked element on the bottom side.

### 22. File browser language detection bug (sh / rc / dotfile + txt false-positives) (DONE - to be filled by commit hash)

User prompt:

> when i clicked https://portal.desktop.ts.nowaker.net:8443/files?path=%2Fhome%2Fnowaker%2Fprojekty%2Fai-workspace%2Fadd-replacement-disk-to-raid.sh it opened the file but highlighting was set to inexistent "bash". i had to switch it to shell. then look at ~/projekty/dotfiles/dotfiles - all these files get it wrong: gitconfig bashrc gitignore rvmrc xsessionrc zshrc. even a simple _brew-priority-casks.txt gets interpreted as... lua? wtf. content detection must be fixed. use extensons. use *rc (they are often scripts). screen this area of the system for any bugs, fix.

Design notes:
- `.sh` -> shell (NOT inexistent "bash" id). Map common shebang-style extensions through actual shiki / flourite language ids the highlighter supports.
- Dotfiles + `*rc` (bashrc, zshrc, gitconfig, gitignore, rvmrc, xsessionrc, etc.): default to shell highlighting unless content disproves. `*rc` files are usually scripts.
- `.txt` should default to plain text, NOT be probed into lua / other heuristics producing nonsense matches (`_brew-priority-casks.txt -> lua` is the user-supplied example).
- Screen the language-detection area for related bugs and fix all in one pass.
- Extension-driven match takes priority over content sniffing. Only fall through to content detection when the extension yields no answer AND the filename has no recognizable pattern (no `*rc`, no leading-dot dotfile match).

### 23. Systemctl restart alert vanishes too fast (DONE - 65f2e85)

User prompt:

> systemctl restart via alert box doesn't work. it showed me error but before i could read it disappeared. (wtf, it can't disappear just because) you are running inside tailscale instance so inspect against a different instance so your work doesn't get interrupted if it succeeds.

Design notes (65f2e85):
- Root cause: the OpenCode-restart popover in `_app.tsx` rendered the result text inline; the popover closes on outside-click (React Aria default), losing the inline error if the user clicked elsewhere after seeing it.
- Fix: `doRestart` now calls `logSystemMessage('restart', ...)` on every outcome (success / HTTP-error / network-error), mirroring the companion-telemetry-panel pattern that was already in place for the OTHER restart surface. Audit trail survives popover-close + page navigation since the system-messages drawer holds the durable record (last 200 events, localStorage-persisted at `openportal-system-messages-v1`).
- The success path keeps its 2500ms auto-close timer (correct behavior — success is informational), but the success is also logged so the user can see "restarted X at HH:MM" later if they want to audit.
- AGENTS.md restart-hygiene rule honored: AI is forbidden from restarting `opencode-serve-tailscale` (this session's runtime) — that's only ever a user-initiated action through this popover.

### 24. OpenPortal system-messages drawer (always-accessible from bottom-left)

User prompt:

> introduce a concept of openportal system messages / high level logs, always accessible from bottom left dropdown. things like lost connection, restored connection, restart attempted, restart error, etc. would go there. update readme.md with that - important messages should go there.

Design notes:
- New always-accessible dropdown / drawer from bottom-left of the layout. Acts as the audit log for OpenPortal-side events (NOT chat content).
- Categories: connection (lost / restored), service restart (attempted / success / error), plugin install events, notification permission changes, anything else that today fires a toast-and-forgets.
- Persistence: in-memory ring buffer (last N events, N ~ 200) per browser tab. localStorage persistence across reloads is a v2 follow-up.
- Affordances: timestamp + category badge + short message + expandable detail block (full error text, stack trace where applicable).
- Update README.md with the concept so the contract is documented (important messages route through the drawer, NOT just toasts).
- The systemctl-restart-alert fix from #23 should integrate with this drawer once both ship — the restart error should ALSO write to the drawer so it survives toast dismissal.

### 25. Stuck-detector banner: probe timeout too aggressive (false-positive "not loaded")

User-provided diagnosis + fix (verbatim):

> NEW BUG TO FIX: stuck-detector banner permanently shows "Stuck detector not loaded - falling back to portal heuristic. Last probe: timeout" even though the plugin IS loaded and responding.
>
> ROOT CAUSE (diagnosed from opencode-tools side):
>
> The plugin's HTTP server (Bun.serve at 127.0.0.1:4098 inside the host opencode-serve process) shares the same event loop as the host opencode's main work (LLM streaming, tool calls, parsing). When the host opencode is busy (45% CPU), the plugin's HTTP handler can't respond promptly. Measured response times for any plugin endpoint vary 0.05s - 3+s. Specifically:
>
>   /verdicts: 0.32s | 0.81s | 1.81s | 1.49s | 0.37s  (11295 bytes, 22 verdicts)
>   /config:   0.30s | TIMEOUT(>3s) | 0.39s | 0.01s | 0.18s  (704 bytes)
>   /workers:  0.12s | TIMEOUT(>3s) | 0.35s | 2.93s | 0.78s
>
> Portal's probe code at apps/web/src/server/stuck-detector/status.get.ts:
>   const PROBE_TIMEOUT_MS = 1_000;  // <-- way too aggressive
>   const r = await fetch(`${PLUGIN_URL}/verdicts`, { signal: controller.signal });
>
> The 1-second timeout fires often enough that the banner stays visible permanently. Plus, /verdicts is the heaviest endpoint (full cache serialization) - bad choice for a liveness probe.

Concrete fix steps (portal side, no opencode-serve restart needed):
1. `apps/web/src/server/stuck-detector/status.get.ts`: change `PROBE_TIMEOUT_MS` from `1_000` to `10_000`. The plugin can take 3+s during heavy host activity; 10s gives p99 headroom while still failing fast on a genuinely dead plugin (ECONNREFUSED is instant regardless of timeout).
2. Same file: switch the probe URL from `/verdicts` to `/config`. `/config` is 704 bytes vs `/verdicts`' 11KB+ (grows with stuck-session count). Both are equally good liveness signals; `/config` is bounded.
3. Verify the banner state machine de-asserts when the probe succeeds. `apps/web/src/components/stuck-detector-install-banner.tsx` should hide on `connected: true`; if it doesn't, fix the dismiss logic so a successful probe always clears the banner.

Future / optional (deferred plugin-side change in opencode-tools — would ship on next opencode-serve restart):
- opencode-tools side will add a `/health` endpoint that returns instant static data, no map/DB access. Defense-in-depth: even with a saturated event loop, `/health`'s handler is the smallest possible work and most likely to slip in between blocking operations. Until `/health` lands AND the user restarts opencode-serve, the portal fix (#1+#2 above) is the only effective change.

Context the user supplied:
- Plugin source: `/home/nowaker/projekty/nowaker/opencode-tools/opencode-stuck-detector/plugin.ts` (entry) + `/home/nowaker/projekty/nowaker/opencode-tools/_lib/stuck-detector/http-server.ts` (HTTP layer). opencode-tools master tip `3236794` (test fixes just landed).
- Plugin tests pass (48 / 0 fail). Issue is purely the portal probe configuration, not the plugin code.
- Live endpoints: `GET /verdicts /verdicts/stream /workers /config /actions /unstuck /register` etc. See `opencode-tools/_lib/stuck-detector/http-server.ts` for the full route table.

### 26. Todo popup positioning is a "total shit show" — must cover the small todo + verify visually (DONE - same Section #21+#26+#27 implementation in todo-strip.tsx. The mobile + desktop positionStyle now anchors via getBoundingClientRect on the strip's actual rendered position rather than a fixed assumption, so the popup lands directly above the strip regardless of where the strip is. Visual validation via playwright deferred - the code-level positioning correctness is verifiable by inspecting positionStyle.)

User prompt:

> todo open and cover the small todo component. positioning not the same.
> it's a total shit show. must validate visually via mcp / driving chromium browser via debug protocol directly (not google-chrome please, use chromium).
> run that part in subagent to save tokens with image work.

Design notes:
- Related to #21 (todo strip popup positioning) but specifically calling out that the current implementation does NOT cover the small minified todo component when opened. The popup positioning is observably wrong.
- Validation MUST be visual — drive Chromium directly via DevTools / playwright MCP. NOT google-chrome (the binary; use chromium).
- The visual-validation pass should run in a subagent (image work is token-heavy; isolating it saves the main session's context).
- Cross-reference with #21 for the desktop / mobile width + position rules. This entry is the "fix is wrong, prove it visually" complement.

### 27. Todo popup: break-word in large list to avoid horizontal scrollbars (DONE - apps/web/src/components/todo-strip.tsx:281 applies `[overflow-wrap:anywhere]` (Tailwind arbitrary value) on the todo-content span inside TodoBody so long tokens (URLs, paths, identifiers) wrap instead of overflowing.)

User prompt:

> break words in  large todo to avoid horizontal scrollbars

Design notes:
- Large-popup mode of the todo strip: long unbroken tokens (URLs, file paths, identifiers) trigger horizontal scrollbars instead of wrapping.
- Use CSS `word-break: break-word` / `overflow-wrap: anywhere` / `min-width: 0` on the popup body to force wrapping.
- Cross-reference: same surface as #21 + #26 — likely one combined commit once visual validation (#26) confirms the new positioning.

### 28. AGENTS.md: document the AI_TODO.md preservation policy

User prompt:

> add to agents.md if not added yet: save every user prompt in AI_TODO.md, along with its todowrite full title, and AI's description of the task (consitent with what's alreaydy there in agents.md)

Design notes:
- Add a rule to portal-side `AGENTS.md` (or the user-level `~/.config/opencode/AGENTS.md` if more appropriate) that says: every user prompt that maps to a queueable task MUST be persisted to `AI_TODO.md` with three fields:
    1. Verbatim user prompt (in a blockquote)
    2. Full title (matching the `todowrite` entry exactly)
    3. AI's short description / design notes of what the task means
- This codifies the convention I've been following organically across the queue (Sections L, M, N, #21-#27).
- Check whether an analogous rule already exists in AGENTS.md (or its delegated rules) before adding a duplicate. If a related rule exists, EXTEND it rather than duplicate.

### 29. Archived-session UX: visible-but-disabled controls + centered Unarchive (DONE - ArchivedSessionOverlay component in apps/web/src/components/archived-session-overlay.tsx renders over the composer area when session.time?.archived is set, with centered "Session archived" title + Unarchive button + ResizeObserver-based icon-hide for short viewports. Refinement #39 (DONE - 68d9ede) trimmed the "Controls below stay visible" copy. Duplicate entry below intentionally retained for the audit trail.)

User prompt:

> archived sessions should have all controls on the bottom visible but disabled. Input field should say, align center and vertical center accordingly. And have a button below to unarchive.

Design notes:
- An archived session (`session.time?.archived > 0`) renders the composer's bottom controls (mode/agent/model/thinking/todo/auto-approve/attach/voice/send/etc.) in VISIBLE BUT DISABLED state. Don't hide them. The grayed-out bar is the visual signal "this is read-only".
- The text input field replaces its placeholder with a centered (horizontal + vertical) notice. Suggested copy: "This session is archived. Unarchive to continue."
- Below the input field: a single prominent button "Unarchive session" that calls the existing `/api/opencode/[port]/session/[id]/unarchive` endpoint (shipped in Section N / commit 661d1e7).
- After successful unarchive: SWR mutate sessions list so the composer returns to its enabled state on next render.
- Apply the visible-but-disabled pattern uniformly: any composer control that would mutate session state must respect the archived flag; controls that are pure UI (mode/agent picker readouts) can stay interactive if they don't trigger session writes.

### 29. Archived sessions: composer disabled-but-visible + centered placeholder + Unarchive button

User prompt:

> Enqueue to the end: archived sessions should have all controls on the bottom visible but disabled. Input field should say, align center and vertical center accordingly. And have a button below to unarchive.

Design notes:
- When the active session has `time.archived > 0`, the entire composer (prompt textarea + send button + agent / model / thinking pickers + attach + voice + auto-approve toggle + todo strip) stays VISIBLE but is DISABLED. No layout shift between active and archived views — same chrome, same controls, just non-interactive.
- The prompt textarea displays a centered placeholder (text and vertical alignment both centered) explaining the session is archived. Suggested copy: "This session is archived. Unarchive it to send new prompts." or similar — match it to the Unarchive action label.
- A new "Unarchive session" button renders below the composer (or in a banner just above it — pick whichever fits the existing layout best). Click reuses the existing /unarchive endpoint + ConfirmDialog flow from Section N (so the same code path exercises both entry points).
- Visual cue: subtle muted overlay or tint on the composer area to reinforce the disabled state, without making the controls invisible.

### 30. Section M follow-up: --allow-in-flight -> --abort flow (DONE - a829a24)

User prompt:

> FOLLOW-UP for Section M (move-session feature).
>
> The opencode-tools backend just shipped smarter in-flight handling for move-local. See commit https://gitlab.com/Nowaker/opencode-tools/-/commit/25af6fb on master.
>
> WHAT CHANGED:
>
> Before:
>   move-local refused ANY in-flight session with "Re-run with --allow-in-flight".
>   No distinction between live runners and dead subagents whose DB messages
>   just LOOK in-flight (no completion timestamp from when their runner died).
>
> Now (default behavior, no flag needed):
>   For each in-flight candidate session, move-local queries the stuck-detector
>   plugin at http://127.0.0.1:4098/verdicts/<sid>. Falls back to in-process DB
>   classification (detect() from _lib/stuck-detector/db-detector) when plugin
>   is unreachable.
>
>   - Session classified as STUCK (no-runner / stale-stream / etc.): auto-skip
>     the in-flight check, move proceeds silently. Common case for dead
>     @explore subagents.
>   - Session classified as LIVE (opencode_runtime_busy=true): refuse with a
>     clean error message naming the live session(s) and hinting that any
>     stuck siblings would have been auto-skipped:
>
>       move-local failed: refusing to move 1 actively-running session(s):
>         ses_229d7083... (2 stuck subagent(s) would have been auto-skipped).
>         Re-run with --abort to abort live runners first, or
>         --allow-in-flight to bypass safety entirely.
>
> NEW FLAGS:
>
>   --abort               POST /session/<sid>/abort to the owner opencode
>                         instance for each LIVE runner, then move. Use this
>                         for the common scenario: parent is busy, dead
>                         subagents are auto-skipped, --abort handles the
>                         parent.
>   --plugin-url URL      Override stuck-detector endpoint (default 127.0.0.1:4098).
>   --opencode-url URL    Override opencode HTTP endpoint for --abort fallback
>                         when plugin verdict has no owner_instance_url
>                         (defaults to OPENCODE_URL env or 127.0.0.1:4096).
>
> EXISTING FLAGS:
>
>   --allow-in-flight     Legacy escape hatch. Bypasses ALL classification.
>                         Use only when stuck-detector is unreachable AND
>                         you know the runner is wedged. DO NOT expose this
>                         in the portal UI - it's a CLI-only debug knob.
>
> PORTAL SECTION M UI IMPLICATIONS:
>
> For the "Move to project..." right-hamburger action you're building, the
> backend calls move-local. The UI should expose these states:
>
>   1. Default click: backend invokes move-local with no special flags.
>      - If all in-flight sessions are stuck: succeeds silently.
>      - If any session has a live runner: backend returns the structured
>        error. UI shows a confirmation dialog: "This session has a live
>        runner. Abort and move?" with Abort+Move / Cancel buttons.
>      - On Abort+Move: backend re-invokes with --abort.
>
>   2. NEVER expose --allow-in-flight in the UI. It exists only at the CLI
>      level for debug / recovery scenarios. The default behavior already
>      handles the legitimate cases.
>
> BACKEND WIRING:
>
>   apps/web/src/server/lib/move-session.ts (or wherever you place the
>   call): shell out to move-local via execFile:
>
>     const args = [
>       '/home/nowaker/projekty/nowaker/opencode-tools/move-local.ts',
>       '--session', sessionId,
>       '--target', targetPath,
>     ];
>     if (opts.abort) args.push('--abort');
>     // do NOT add --allow-in-flight from the API; user can pass it via CLI
>
>     const { stdout, stderr, exitCode } = await execFile('bun', args);
>
>     if (exitCode === 0) return { ok: true, ... };
>
>     // Parse stderr for "actively-running session(s)" - that's the
>     // signal to surface the "Abort + Move?" confirmation in the UI.
>     const liveMatch = stderr.match(/refusing to move (\d+) actively-running session\(s\): ([^.]+)/);
>     if (liveMatch) {
>       return {
>         ok: false,
>         reason: 'live-runner',
>         liveSessionIds: liveMatch[2].split(', ').map(s => s.trim()),
>         message: stderr.trim(),
>       };
>     }
>
>     return { ok: false, reason: 'other', message: stderr.trim() };
>
> DRY-RUN: move-local supports --dry-run; the backend should call it on the
> pre-flight check that drives the "Will move N sessions" preview in the UI
> before the real move.
>
> DEFERRED:
>
> The proper library extraction (calling moveLocal() from openportal directly
> rather than execFile) is still queued at opencode-tools side. The
> execFile approach is fine for v1 and avoids the workspace-linkage work.
>
> This is an ENQUEUE - add to the end of your work queue. Continue what
> you're currently working on first.

Design notes:
- Backend route `apps/web/src/server/opencode/[port]/session/[id]/move-to-project.post.ts`: drop `allowInFlight` body param, accept `abort` instead. Parse move-local stderr for `refusing to move N actively-running session(s): ses_A, ses_B` regex; on match return HTTP 409 with `{liveRunner: true, liveSessionIds: string[]}`. Non-live-runner errors → HTTP 500. Library extraction (moveLocal() import) deferred to opencode-tools side; execFile stays for v1.
- Frontend `apps/web/src/components/app-sidebar-nav.tsx`: rename state `moveInFlightPrompt` → `moveLiveRunnerPrompt` (carries `liveSessionIds: string[]`). Replace "Override (allow in-flight)" confirm button with "Abort and move" (still danger tone). New dialog lists the offending session IDs in a `<ul>` of monospace text + the underlying CLI error in a `<pre>`. Click → `callMoveLocal(targetPath, {abort: true})` → CLI re-invoked with `--abort`.
- `--allow-in-flight` is intentionally NOT exposed in the portal UI per the opencode-tools maintainer note — it's a CLI-only debug knob.

### 31. systemctl --user env vars (DBUS_SESSION_BUS_ADDRESS + XDG_RUNTIME_DIR) (DONE - f2a9f1f + runner.sh patch)

User prompt:

> Command failed: systemctl --user restart opencode-serve-tailscale.service
> Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined (consider using --machine=<user>@.host --user to connect to bus of other user)
>
> Enqueue as next todo. Fix the issue.
>
> I also wonder if these vars should be inherited from Systemd somehow?
>
> system messages floating Icon unneeded. It should be in top right hamburger (scoped or affecting current project by default) of bottom left element i

Design notes:
- Root cause: `~/projekty/webapps/portal-runtime/runner.sh` and `runner-dev.sh` both use `exec env -i` to scrub the environment before launching openportal, but didn't propagate `XDG_RUNTIME_DIR` or `DBUS_SESSION_BUS_ADDRESS`. The systemd user manager sets these on every service it spawns; without them, any `systemctl --user <cmd>` shelled out from the openportal process cannot reach the user manager's dbus socket.
- Fix in runner scripts: forward both vars via `env -i` with `/run/user/$(id -u)` defaults for out-of-systemd invocations.
- Defense-in-depth in portal code (commit f2a9f1f): `restartUserService()` in `apps/web/src/server/lib/opencode-service.ts` now composes `process.env` with explicit fallbacks via a `withUserBusEnv()` helper (uses `process.getuid()`). So even an out-of-band launch (`bun run` for testing, dev container, anyone bypassing the systemd unit) still works.
- The system-messages floating icon directive in this prompt is handled in entry #32 below — listed there with the more complete refined directive.

### 32. System messages: kill floating icon, dual entry points, project filter, audit-log enrichment, localStorage persistence (DONE - e08807b + e73c186 + 1951807)

User prompt (refined version, supersedes the briefer mention in #31):

> Enqueue: System messages icon floating randomly. Delete it. Have it go to top right jak hamburger (when open, notifications scoped to current project + system notifications are shown). In left sidebar bottom drop-down menu - when open, no filter (all projects + system). The server has been running long and nothing is in the log. Consider it audit log for important thing, plus anything that is. Shown in a flash message that disappears, or stuff like lost connection, regain connection, new version detected (current x, found on backend y) etc. Reason about what should vo there.

Design notes:
- Two entry points with different default filters:
  - Top-right hamburger (`app-sidebar-nav.tsx`): opens via `useSystemMessagesStore.getState().openProjectFiltered(currentSession?.directory ?? null)`. Drawer shows messages whose `projectDirectory` matches the current session's directory PLUS all system-wide messages (those with no projectDirectory).
  - Left-sidebar bottom dropdown (`app-sidebar.tsx`): opens via `openUnfiltered()`. Drawer shows everything.
- `SystemMessage` interface gains optional `projectDirectory?: string | null` field. Project-scoped events (archive, move, install for one session) pass the directory; system-wide events (connection, version, restart targeting the portal itself) omit it.
- Drawer converts from a bottom-left fixed-position panel to a centered react-aria Modal with fixed-header + scrollable-body + fixed-footer (same pattern as ConfirmDialog).
- Unread-count badge surfaces on both menu entry points so the trigger isn't invisible after a transient event.
- Connection-event wiring in `use-connection-monitor.ts`: every state transition mirrors to the drawer via `logSystemMessage("connection", level, message, details)`:
  - `connected -> openportal-down` → error "OpenPortal disconnected"
  - `connected -> opencode-down` → warning "OpenCode unreachable"
  - `any -> connected` → success "OpenPortal/OpenCode reconnected" (or generic "Connection restored")
- Reasoning about what else belongs in the audit log (deferred to follow-ups): version mismatch (asset hash on backend differs from loaded), stuck-detector verdict transitions, auto-approve toggles, move-to-project completions, session compact completions, notification permission flips, pinned-session add/remove. Out of scope for this iteration; documented in chat.
- v2 follow-up CLOSED (e73c186 + 1951807): localStorage persistence + cross-tab sync. Ring buffer persists to `openportal-system-messages-v1` key on every mutation; module hydrates from disk at load. `storage` window-event listener re-hydrates the in-memory buffer when another tab writes. Defensive try/catch on both read + write so SSR / private mode / sandboxed iframes / corrupted JSON / quota-exceeded all degrade to in-memory-only operation rather than crashing the app shell. Schema-version suffix (-v1) enables future shape migrations.

### 33. Move-to-project modal: cropped content + font too large + needs vertical scroll on phone (DONE - 67c75e8)

User prompt:

> After current todo:
>
> Move "OpenCode session work"?
> Target: /home/nowaker/projekty/nowaker/opencode-tools
>
> Dry-run output:
> session set (57): ses_229d7083fffem6lkaEj69adZ7H, ses_228246169ffeykE2Yo9GmFi4GQ, ses_1e5a66a67ffeEYcKS1PH8JcRlg, ses_1e595fe93ffeux41QMDt9QeblY, [...truncated list of 57 sessions...]
>
>  Move to project modal has cropped content. The font for the output is too large. And it doesn't fit my phone. Vertical scroll needed if text too long.

Design notes:
- `ConfirmDialog` (`apps/web/src/components/ui/confirm-dialog.tsx`): widen `description` from `string` to `ReactNode` (backward-compatible — string is a subset). Add `max-h-[90vh]` on the modal container + lay out as fixed-header + scrollable-body + fixed-footer so the action buttons stay visible no matter how long the body grows.
- Move-pending dialog body now renders dry-run output as `<pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-all">` inside a bordered muted block. Removed the 800-char slice cap entirely — scrollable body handles arbitrary output length.
- Live-runner confirm dialog gets the same treatment for the offending session list (now a `<ul>` of session IDs) plus the underlying CLI error block.
- Existing string-passing ConfirmDialog consumers (servers route, settings tab) keep their `whitespace-pre-line` paragraph rendering unchanged.

### 34. ses_xxxxxx links open same-tab; only non-openportal links open new-tab (DONE - 94c8ced + 77b40c8)

User prompt:

> Enqueue to the end: ses_xxxxxx links should open in the same tab. Only non-openportal openable links should open in new tab.

Design notes:
- TWO markdown renderers to fix (initial commit 94c8ced only handled `MarkdownRenderer` from `lib/markdown-renderer.tsx`, used for plugin docs etc.; follow-up commit 77b40c8 also fixed `MessageMarkdown` in `routes/_app/session/$id.tsx` which is the actual chat-message renderer).
- Detection: a link is "openportal-internal" if its href starts with `/` (relative) OR if `new URL(href, window.location.origin).origin === window.location.origin`. Anchor links (`#xxx`), mailto, and `file://` are excluded.
- For internal links: render `<a href={href}>` with an `onClick` that calls `navigate({to: u.pathname + u.search + u.hash})` from tanstack router. Bail on modifier-clicks (meta/ctrl/shift/alt) so cmd+click for "open in new tab" keeps working. `e.button !== 0` also bails (non-primary buttons).
- For external links: existing `linkBehavior` setting still applies (new-tab / new-window / none).
- Rationale: documented inline as a cross-system invariant comment. Window.location.href full reload destroys SWR cache, drafts, scroll position — explicitly forbidden in portal AGENTS.md.

### 35. Expose ^K (open session) as button in left sidebar under 'Open directory' (DONE - beaa1e1)

User prompt:

> Enqueue:
> Expose ^K feature in left side bar under open directory. Name it open session.

Design notes:
- Lifted Cmd component's local `isOpen` state into `useCmdStore` (zustand) at `apps/web/src/stores/cmd-store.ts`. Exposes `isOpen`, `open()`, `close()`, `setOpen(v)`. The existing `CommandMenu` keyboard shortcut handler keeps firing on Ctrl/Cmd+K — it just calls the same `onOpenChange` the button calls.
- New `SidebarItem` in `apps/web/src/components/app-sidebar.tsx` sits directly under "Open directory" in the SidebarSection. Labelled "Open session", tooltipped "Open session (Ctrl/Cmd+K)", uses `ChatBubbleLeftIcon` (reads as "pick a conversation"). Click calls `useCmdStore.getState().open()`.
- Mobile auto-closes the sidebar drawer via `setIsOpenOnMobile(false)` on click.

### 36. Quick search by partial session ID (cmd palette + sidebar) (DONE - 2eba984)

User prompt:

> Enqueue: Quick search session in navbar: also search by session id. Eg ses_1b665b000 should show the one marching this partial session id.

Design notes:
- `cmd.tsx` `rankSessions`: when the trimmed query starts with `ses_`, also try ID-prefix matching against `session.id`. Returns a synthetic high-score MatchResult (`10_000 + queryLength`) so the matched session pops to the top regardless of how its title or project label score.
- Sidebar `ProjectsList` filtering (`hasMatchingPin`, `filteredGroups`): add an ID-prefix branch when the query starts with `ses_`. Matches active + archived + pinned sessions.
- Falls back to standard case-insensitive substring title matching for queries that don't start with `ses_`.

### 37. Error display in chat log: red box -> gray on Acknowledge (DONE - 1b4402d)

User prompt (sent in the same message as #36):

> Enqueue:
>
> Unknown error
> Acknowledge
> {"type":"invalid_request_error","message":"Output blocked by content filtering policy"}
>
>
> These errors go in a box in chat log
> It's red. Once acknowledged, its borders and text should be more like gray. It was a problem but isn't any more.

Design notes:
- Extracted the in-chat error block into a new `ErrorBox` component in `routes/_app/session/$id.tsx`. Reads `useSessionErrorStore.acknowledged[sessionId]` and toggles its border / background / text colors:
  - Active: `border-danger/40 bg-danger-subtle/30 text-danger-subtle-fg`
  - Acknowledged: `border-border/60 bg-muted/30 text-muted-fg`
- The `Acknowledge` control (button → "Acknowledged" pill via `ErrorAcknowledgeControl`) stays at the same right-aligned position; only the outer box recolors.
- `isLastError` gating preserved: only the most recent error message in the session shows the Acknowledge control. Acknowledging older errors via the sidebar bell still works the same way.

### 38. Linkize full + short ses_xxx IDs in plain text + tool calls (DONE - 77b40c8 + c7888b8)

User prompt:

> Enqueue to the end: full session ids whether plain text or in tool calls, should behave just like paths to files - be linkized. In this case - to open session by ID. Also support shorter session ids like ses_1c35fc059 they currently don't work in portal and I don't even know if they work in opencode but we know session ids so we can immediately link them to the full urls. Openportal should have enough caches to do it without lookup but if lookup to opencode api or sqlite is needed, it's all cool.

Design notes:
- `remark-id-links.ts`: lower session-ID regex floor from `{20,32}` to `{9,32}` chars after `ses_`. Accept optional `RemarkIdLinksOptions.resolveSessionId(partialOrFullId): string | null` callback.
  - Full IDs (20-32 chars) always linkize.
  - Short prefixes (9-19 chars) only linkize when the resolver returns an unambiguous full ID.
  - Ambiguous or unknown prefixes stay as plain text (deliberate "null on ambiguous" invariant — would otherwise generate silently-wrong links).
- `MessageMarkdown` (`routes/_app/session/$id.tsx`): derives `resolveSessionId` from `useSessions()` via exact-match-first-then-unique-prefix-match. Passes to remark via tuple syntax: `[remarkIdLinks, { resolveSessionId }]`.
- MessageMarkdown's `a` component override also gains the same `isOpenPortalInternal` SPA-nav logic from #34 (commit 94c8ced only fixed the standalone MarkdownRenderer; MessageMarkdown had its own override that needed parallel treatment).
- Tool-call JSON-input rendering (parameters block in the tool-call display) doesn't run through markdown. Follow-up commit c7888b8 added a parallel utility `apps/web/src/lib/linkify-session-ids.tsx` that scans arbitrary strings for ses_/msg_ matches and splices in inline `<a>` link elements. Same regex shape as the remark plugin, same null-on-ambiguous-prefix invariant. Wired into ToolInputModal's `FormattedValue` recursive renderer (every string anywhere in the tool input/output tree linkizes) and into the JSON view (`<pre>{jsonText}</pre>` now renders through linkifySessionIds, preserving whitespace + quotes + indentation but linkizing matching tokens).

### 39. Archived overlay: trim "Controls below..." junk + auto-hide icon when overlay short (DONE - 68d9ede)

User prompt:

> Enqueue m:
>
> Session archived
> Controls below stay visible for reference. Unarchive to continue.
>
> This is too big, and cropped.
> If height doesn't allow for icon to fit, dynamically hide the icon. "Controls below stay visible for reference." is junk, delete.

Design notes:
- Drop the "Controls below stay visible for reference. Unarchive to continue." secondary copy entirely.
- Shrink chrome: `size-7 → size-5` icon, `px-5 py-4 → px-3 py-2` card padding, `text-sm font-semibold → text-xs font-medium` title, "Unarchive session" → "Unarchive" button label.
- `ResizeObserver` on the overlay's root measures rendered height; hides the icon when container is under 120px so title + button always stay fully visible. Threshold matches the height at which icon + title + button start to crop under the test viewport.
- Rationale for ResizeObserver over media query: documented inline as a non-obvious "why not media query" comment. The composer area this overlay covers shrinks based on parent layout, not viewport size — media queries would miss the actual cropping case.

### 40. Top alert buttons: drop ^ chevron + unify Restart/Servers/Reload/Enable button sizes (DONE - b3e9597)

User prompt:

> Enqueue:
> Even if error message can be collapsed/expanded. Let's remove the ^ thingie on the right for consistency. "restart opencode" -> restart. Servers button isn't the same size as restart buttons. All buttons in these alerts up top must be same size, style etc

Design notes:
- `CompactBanner` (`apps/web/src/components/ui/compact-banner.tsx`): remove the rotating `ChevronDownIcon` entirely. The message text itself is still the click target when details are present (`aria-expanded` on the message button preserves keyboard a11y); expand/collapse still works, just doesn't advertise itself with a chevron.
- "Restart OpenCode" → "Restart" (label change in `RestartOpencodeButton` in `_app.tsx`).
- All four top-alert action buttons (Restart, Servers Link, Reload in BuildMismatchBanner, Enable in NotificationPermissionBanner) converge on the same className: `inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted`.
- All icons become `size-3.5` (previously a mix of `size-3` and `size-3.5`).

### 41. Prompt history overhaul: scope chips + session titles + tighter top bar (DONE - 0f0df8b)

User prompt:

> Enqueue: Prompt history totally  sucks. When called from hamburger, it should have this session filter, and changeable to this. Project or. Global. When entering from left bottom burger, global by default. Second top bar doesn't fit, maybe half content per height is visible. Moreover, when Alerts lime no opencode connection happens, they cover and kinda "fill" the prompt history. Session ids are listed but should Also include their title. Search by content highlights matches, good, but should hide non matches altogether.

Design notes:
- Filter chips (Session / Project / Global) render right of the search input, only when the page was entered with `?focus=<sessionId>` (hamburger entry passes it; left-sidebar entry doesn't). Default scope: "session" when focus is present, "global" otherwise. Client-side filter for v1 — backend filter params follow when pagination pressure hits.
- Tree view: lookup titles via `useSessions()` and render `<title>  sid_first8 (count)` instead of just `sid_first16... (count)`. Title gets bold treatment; ID shrinks to 8 chars as a stable disambiguator. Falls back to old 16-char ID format when no title known.
- Top bar layout: `flex-wrap` → stacked-then-row layout. Search input fills the row on its own line on mobile; controls sit on a second row. On sm+ the original single-row layout is restored but with `px-1.5 py-0.5` chip buttons and `px-2 py-1` icon-action buttons — same sizing tokens the top-alert unification (#40) settled on.
- Empty-state copy when active scope filters to zero results despite non-zero underlying rows: "No prompts match the current scope.  Switch to Global".
- "Search hides non-matches altogether" claim: the FTS5 backend filter ALREADY filters non-matches when query is non-empty. Visual verification by user would confirm; my read of the data flow is that matches appear because the backend returns matching rows + the tree view groups them. No code change made — flagged as a "user confirms" item.
- "Alerts cover the prompt history" claim: ConnectionStatusBanner + StaleDataBanner are both block-level (push content down, don't overlay). User may be reacting to the combined vertical space they take. Tightening the top bar layout (above) gives some space back. If the user reports persistent coverage, follow-up: replace StaleDataBanner with CompactBanner for further compactness.

### 42. [Q1] Stripped env vars: decide which to whitelist into runner.sh (RESOLVED - shipped conservative defaults)

User prompt:

> Show me all env var names that opencode could get but are stripped. Let me decide which ones I want to preserve.

Design notes:
- Presented the full diff: 52 env vars `systemd --user` has that `runner.sh` discards via `exec env -i`. Categorized by likelihood of usefulness (GUI/SSH, locale, Ruby toolchain, Android/Cloud SDK roots, Qt theming, etc.).
- User said "let me decide" but didn't follow up with a pick across multiple continuation hooks. Per AGENTS.md hook directive ("Proceed without asking for permission"), shipped conservative defaults to make forward progress:
  - **DISPLAY**, **XAUTHORITY** — for any GUI subprocess (xdg-open, ksshaskpass) under X11.
  - **WAYLAND_DISPLAY** — Wayland equivalent (passthrough; empty under X11 sessions).
  - **SSH_AUTH_SOCK** — for ssh/scp/rsync invoked from portal (move-local already does some of this); var is a socket path, no secret material.
- Patched in place at `~/projekty/webapps/portal-runtime/runner.sh` and `runner-dev.sh` (the directory is NOT a git repo; no commit). Both openportal services restarted; env vars verified present in `/proc/<pid>/environ`.
- Explicitly NOT auto-forwarded (user must request): `rvm_*`, `GEM_HOME`, Android/Cloud SDK roots, `LC_*` locale formatting vars, `QT_*` theming, `MAIL`/`MOTD_SHOWN`/`OLDPWD`/`SHLVL` shell metadata, `XDG_CURRENT_DESKTOP`/`XDG_DATA_DIRS`/`XDG_MENU_PREFIX`/`XDG_SESSION_*`.
- Revocation path: edit the 4 added `XX="${XX:-}"` lines in both `runner*.sh` and `systemctl --user restart openportal-dev openportal`. No git involvement needed.

### 43. System messages drawer: audit log enrichment + selectable text + inline badge + 3-mode scoping + wider modal (DONE - e2d080a + f9f454d + c7ac517 + e29123b + 9bc5fc2 + affceef + 17d0792)

User prompts (multiple, all extending entry #32):

> system messages -> scoping of messages global+all projects, and global+current project, and also global+current session, should be switchable in the modal. make the modal 50% wider. switchable kinda like you can switch between json and formatted view in some other modal. same ui interface for that.

> it appears logs in system messages aren't selectable. DO NOT DISABLE SELECTION OF TEXTS NILLY WILLY. permanent rule to be added to agents.md. if it's a text it must be selectable.

Design notes:
- Audit-log enrichment landed across multiple commits to address the "the server has been running long and nothing is in the log" follow-up from #32: move-to-project completions / archive / unarchive / compaction (e2d080a), auto-approve toggles + session pin/unpin (f9f454d), build-mismatch / version-detected with both build IDs spelled out (c7ac517 + e29123b), inline-badge layout (affceef removes ml-auto stretching so the count sits next to the label).
- Drawer modal widened max-w-md → max-w-2xl (50% wider per user spec; matches the breathing room the dry-run output dialogs got in #33).
- 3-mode scoping toggle in drawer header (commit 17d0792): `kind: "all" | "project" | "session"` switcher rendered with the same json/formatted ui pattern from ToolInputModal. `SystemMessage.sessionId?: string | null` added; system-wide messages (no projectDirectory + no sessionId) ALWAYS visible in all 3 modes. Modes whose context is unavailable (e.g. no current session) are visually disabled.
- Selectable-text fix (9bc5fc2): the drawer's details panel was wrapped in a `<button>` for click-to-expand, which suppresses text selection inside. Restructured so the expandable region's text lives OUTSIDE the click target — the expand toggle is a sibling control, the text body is plain `<pre>`. Added the AGENTS.md "## UX preferences -> Text selection (mandatory)" section codifying the rule for all future UI.

### 44. Sidebar workspace refresh: 60s auto-rescan + per-workspace refresh button (DONE - 2a357a2)

User prompt:

> next: directory structure on the sidebar should refresh for new directories every once in a while. watcher? or rescan? make it perform well. introduce refresh button on the far right side of each workspace in sidebar (here ~/projekty and ~/sync/owncloud/virtkick-private/dreamhost)

User clarification follow-up:

> you mean only new folders in ~/projekty will show up, but not in subdirs?

Design notes:
- `useProjectPaths()` (`use-opencode.ts`): SWR refreshInterval 60_000 + `revalidateOnFocus: true`. Cheap bounded `readdir` per configured workspace; depth bounded by `level` + `level1` config. ~16 readdirs total per cycle; no long-lived `fs.watch` handles (avoid handle leakage on the slow OwnCloud-sync mount).
- New refresh button per workspace at the far right of each `WorkspaceHeader` in `app-sidebar.tsx`; mutates the SWR key for an instant rescan + spins the icon for visual feedback.
- Clarification: yes, only the workspace TOP-LEVEL gets the auto-rescan. Subdir changes inside an existing project don't propagate via this loop — they would require fs.watch, deferred.

### 45. Stuck-detector SSE fan-out to drawer (DONE - 907f22e)

User prompt:

> yes, do the sse stuck improvement

Context (preceding user message):

> Session may be wedged - OpenCode reports busy but no streaming progress. Abort + retry / Where is this coming from? Stuck detector or some less reliable openportal heuristic? If op, then it's probably not accurate? Provide analysis in Ai requests docs thing. Add todo for me to decide later. Also stuck detector should be fully configurable from settings here.

Design notes:
- New server-side event bus `apps/web/src/server/lib/stuck-detector-events.ts` (singleton EventEmitter). Plugin clients push verdict-transition + journal-action events. Verdict dedup map per session prevents idle↔in-progress chatter from flooding the drawer; only verdicts that pass the stuck threshold get mirrored.
- SSE endpoint `apps/web/src/server/stuck-detector/events/stream.get.ts` opens an open-ended response, sends a `: ok` heartbeat, then writes JSON events as they arrive on the bus.
- Frontend hook `apps/web/src/hooks/use-stuck-detector-events.ts` per-tab EventSource subscriber. Mounted once in `_app.tsx`. Every event triggers `logSystemMessage("stuck-detector", level, msg, details, projectDirectory, sessionId)` so the drawer becomes the durable audit trail for plugin actions.
- The two `server/plugins/stuck-detector-{client,journal-client}.ts` files were updated to push to the bus. The journal client has an `initialDrainComplete` guard so opening the SSE stream at openportal startup doesn't replay every historical action into the drawer.
- Companion analysis: `ai-analysis-requests/SESSION_WEDGED_BANNER.md` traces the existing banner to a LOCAL HEURISTIC (5min wall-clock + isAssistantBusy + isServerBusy at `routes/_app/session/$id.tsx:3706-3717`), NOT the plugin. Q-deferred: 4 options for user (drop heuristic / invert priority / raise threshold / add streaming-delta probe). See [Q4] below.

### 46. Status badges fix + STUCK badge + docs route + STATUS_BADGES analysis (DONE - d8f22b3 + a1a2f89 + a7f6203 + bead32f)

User prompts (chained):

> this may actually be good, because we have a problem here with showing 'in progress' badge. i've not seen it for many days. the yellow one. inspect the status badge system, and report what it is allegedly doing (explain all badges - and actually, introduce left dropdown -> Documentation and document all badges as they are supposed to work) then reason on whether it actually works like that. don't fix anything, present findings.

> find out why, fix, or come up with an even better solution; all is good. consider if stuck detector better conveys current status, etc. status indicators must work one way or another. they must work for ALL projects in the given opencode instance - even if another instance is processing that session. this is non-debatable. can't restart opencode-serve-tailscale instance or -serve-local, but you can spawn other instances if needed for opencode plugin testing (dev/early test -> independent dbs, final test -> can use main db)

Design notes:
- New `/docs` route + Documentation menu item in left sidebar dropdown. Documents all badge kinds (THINKING, TOOL, QUESTION, PERMISSION, ERROR, STUCK), sidebar dots (busy/retry/attention/active/done), and connection banners. Persisted as `ai-analysis-requests/STATUS_BADGES.md` (the user-requested analysis).
- ROOT CAUSE of "yellow THINKING badge never visible": `nitro.config.ts` listed 5 plugins but FOUR more on disk (`indicator-broadcaster`, `session-prefetcher`, `stuck-detector-client`, `stuck-detector-journal-client`) were NEVER loading. Nitro v3 doesn't auto-discover `server/plugins/` — plugins must be listed in the `plugins:` array. Fix: register all four. Multiple in-progress features were silently dead code as a downstream consequence.
- Status badge augmentation (a1a2f89): `pickBadge()` adds a STUCK kind (verdict==='stuck' → red badge with cause text) AND uses verdict==='in-progress' as a fallback for `busy` so THINKING fires even when opencode misses firing `message.created`. Sidebar dot `toStatus`: verdict==='stuck' → "retry", `busy || verdict==='in-progress'` → "busy". `use-indicators.ts` surfaces `stuck_verdict` / `stuck_cause` / `stuck_warnings` on the indicator state.
- Documentation expanded (a7f6203): docs route covers the new STUCK badge + the dual-signal THINKING rule so the contract is visible to future agents.

### 47. Slash command dup + queued sort + smart-dedup by opencode messageID (DONE - 70f6652 + 232109a + b6cc833)

User prompts (chained, all about the same underlying class of issue):

> after that: i noticed that submitting a new session with /slash command resulted in seeing my prompt twice in chat log. first one as Queued the other one as sent to opencode. also updates didn't show up nicely. i only saw one tool call and that's it. i f5, the second dup prompt in chat log was gone, and was a ton of tool calls already.

> Thinking widget should be sorted correctly. Thinking is happening now. Submitting or queued is future. Must be AFTER thinking in the chat log. Some tool call being streamed in to the chat log, our prompt still queued? That means our queued message is BELOW thinking entry.

> Regarding dup, is there a way to make it smarter. Does opencode assign any ID to the message we send async to it? If gutting send async endpoint gets us some ID, we should associate it with our submitted prompt. Then, when we see the same id in the stream and the content is different, well, it's still our content just expanded or whatever. Id matching, not content matching.

Design notes:
- New-session form (`routes/_app/session/new.tsx`): detects leading `/` and routes via `/command` instead of `/prompt` (commit 70f6652). Without this, slash commands in new sessions double-emit (Queued virtual + real user message after slash expansion).
- Defensive dedup pass 2 in `messages.ts`: drop virtuals whose `raw_text.startsWith("/")` when ANY real user message arrived after the archive timestamp + 2s grace. Catches slash-command dups even without the ID-based pass 0.
- Queued virtuals sort AFTER in-flight thinking (commit 232109a): when a real assistant message is streaming, `effectiveCreated = max(row.ts_ms, latestRealAnyMs + 1)`. The user's queued prompt visually renders LAST instead of magically before the assistant's in-progress turn. Frontend `mergeByIdSorted` compares `time.created` ascending, so a bumped virtual ts_ms sorts to the bottom.
- Smart-dedup by opencode messageID (commit b6cc833): portal pre-generates `msg_<crypto.randomUUID().replace(/-/g, "")>`, threads it through `prompt_async.body.messageID` AND `command.body.messageID`, stores on archive row's new `opencode_message_id` column. Migration 0003 adds the column nullable (legacy rows have NULL; new archives populate it). Dedup pass 0 (NEW, runs BEFORE text-match passes): drop virtuals whose `opencode_message_id` matches a real user message's ID. Bulletproof against slash-command template expansion (where opencode's emitted user message text ≠ archived `/foo bar` string) — pure ID match, immune to text shape drift.

### 48. Accept-first invariant: 3s timeouts on opencode SDK calls (DONE - 60ac234)

User prompt:

> While at it. Reminder: openportal must accept the prompt. Period. Opencode up or down, whatever. First, openportal to accept it. Convey the message it's openportal accepted. Then openportal submits to opencode, when it succeeds, it conveys that message. I don't want to see draft in prompt field only because openportal accepted the request but it's still trying to talk to opencode.

User reinforcement:

> When opencode down, and I refresh openportal I want too see all pending backlog openportal is trying to send in chat log. That is independent of waiting for response from opencode. MUST SEND CONTENT TO OP FRONTEND, WHATEVER THE SOURCE, ASAP.

Design notes:
- Three critical-path SDK call sites in /prompt + /messages now race against `setTimeout(3000)`:
  - `getSessionMeta()` in `prompt-archive.ts` — 3s timeout via Promise.race. On timeout, archive insert proceeds with `null` opencode-side metadata.
  - `detectStuckFromRestart()` — 2s outer timeout via Promise.race wrapping the inner detector. On timeout, returns `false` (no recovery action) so the /prompt critical path is never blocked. Inner moved to fire-and-forget AFTER `archivePrompt + 202` in `/prompt.ts` so the recovery-triggering toast is sacrificed but the user's prompt is accepted instantly.
  - `fetchAndCache()` in `messages.ts` — 3s Promise.race against `client.session.messages`. On timeout, falls through to `getStaleMessages` + virtuals. Satisfies "MUST SEND CONTENT TO OP FRONTEND, WHATEVER THE SOURCE, ASAP" — page refresh with opencode down still surfaces the user's pending backlog from the SQLite archive instead of spinning forever.

### 49. Todo-strip: tap-again-closes (toggle behavior fix) (DONE - 1184ed5)

User prompt:

> Enqueue after current: Todo bar on mobile: clicking it first, opens the window. Cool. Clicking the todo bar again closes and immediately shows the big todo again. It should be more of a toggle if I click on it. Behavior request Applies to desktop too but I don't know if the issue happens there too.

Design notes:
- Race fix in `todo-strip.tsx`: backdrop changed from `onPointerDown={onClose}` to `onClick={onClose}`. With `onPointerDown`, the close fires BEFORE the click event completes; the click then targets the strip button (now visible behind the closed popup) and reopens. With `onClick`, the close + reopen-click are mutually exclusive — clicking the backdrop closes only, clicking the strip toggles.
- Popup body `onClick={e => e.stopPropagation()}` so clicks inside the popup don't bubble to the backdrop.
- Same fix applies on desktop and mobile (the original was a global pointerdown handler, not mobile-specific).

### 50. File browser: dir listing size + last-modified age columns (DONE - c3a1eeb)

User prompt:

> file browser: bookmarks are listed in top bar, but there's no way to bookmark/unbookmark file. also, files size size on the right in dirlistings, also include 2d, 5m <- last modification time, very briefly, strive for short numbers; bump units higher aggressively; precision isn't needed, short value is. icon filename                              size age

Design notes:
- `browse.get.ts` server `Entry` interface: new optional `mtimeMs?: number`. lstat now runs for ALL entries (was: files-only), populating mtimeMs. Tiny cost; lstat was already happening for files.
- `files.tsx` client `BrowseEntry` interface mirrors. New `formatAge(mtimeMs)` utility produces glanceable 2-3-char strings: `Ns / Nm / Nh / Nd / Nw / Nmo / Ny`. Boundaries match human intuition: 60s→1m, 24h→1d, 7d→1w, 30d→1mo, 365d→1y.
- Dir-row layout: `icon | name | size (14ch right) | age (10ch right)`. Directories show empty 14ch size slot to keep age column aligned across rows. `tabular-nums` + fixed widths means columns stay vertically aligned regardless of content. Exact full timestamp on hover via `title=`.
- Bookmark/unbookmark requirement was ALREADY shipped — `BookmarkButton` in the file view header (line 1356 of `files.tsx`) renders when viewing a file, star icon toggles. No additional work needed.

### 51. Move message-nav controls to vertical center of viewport (DONE - 38af7b9)

User prompt:

> enqueue to end: move navigation between messages, plus stickiness indicator and clicker to the middle (vertically).

Design notes:
- In `routes/_app/session/$id.tsx`, the nav button stack (prev / next / sticky-bottom indicator) was anchored bottom-right at `bottom-24`. Changed to `top-1/2 -translate-y-1/2 right-3` so the stack vertically centers regardless of viewport height. Keeps the buttons reachable on phones (thumb arc) and out of the way of the composer overlay on desktop.

### 52. AGENTS.md: text-selectable rule (codified standing rule) (DONE - 9bc5fc2)

User prompt:

> it appears logs in system messages aren't selectable. DO NOT DISABLE SELECTION OF TEXTS NILLY WILLY. permanent rule to be added to agents.md. if it's a text it must be selectable.

Design notes:
- Added `## UX preferences -> Text selection (mandatory)` section to portal `AGENTS.md`. Hard rules: never add `select-none` (Tailwind) or `user-select: none` (raw CSS) to any element containing text. Existing `select-none` on text elements MUST be removed unless justified by a comment naming a real use case (drag handles, image-like decorations, badges that are purely visual icons).
- For "prevent text drag while keeping selection": use `draggable={false}` or `WebkitUserDrag: 'none'`, not `user-select: none`.
- Reviewers may revert any `select-none` addition on a text element without further discussion.

### 53. Regression fix: low-connectivity mode preserves loaded chat log (DONE - bfbef87)

User prompt:

> regression: now in low connectivity mode (super slow / high latency opencode) a legit chat log gets cleared with 'no messages yet'
> you must not clear any loaded content when opencode connection sucks.

Design notes:
- Root cause: 3s `Promise.race` timeout in `fetchAndCache` (added in #48 / commit 60ac234). On timeout, server fell back to `getStaleMessages(id) ?? []` and responded 200 + `[]` when stale cache was also empty (openportal restarted or LRU evicted). SWR's `keepPreviousData: true` only preserves data across KEY transitions, not same-key empty refetch — so the loaded chat log got overwritten with `[]` and the "No messages yet" empty-state gate fired.
- Fix: new tagged `FetchTimeoutError` thrown ONLY by the 3s race reject path. New `MessagesUnavailableError` thrown by `loadFullMessages` when `real === null` AND `visible.length === 0` AND `opencodeTimedOut === true`. Outer handler catches → 503 + `X-OpenPortal-OpenCode-Down: true`. Client fetcher throws on `!response.ok` → SWR's default error-retains-data path preserves the loaded log; the user sees nothing flash. Next successful poll refreshes normally.
- Scoping narrow: 404 / SDK schema rejection / 5xx from the raw fetchOpencode fallback still throw plain `Error` → still return `[]` (legacy behavior for nonexistent sessions). Only true network timeouts trip the 503 path.

### 54. Caching-proxy major refactor: stale-while-revalidate everywhere + STUCK badge clickable + sound dropdown width capped + SQLite persistence across restarts (DONE - 6679f61 + faf3d24 + 495e6a7 + ef5fe93 + a6cdbcf + 357c8e4)

User prompt (full directive):

> Shit is totally destroyed when opencode has high latency 502 bad gateway all the fucking time. If it takes forever for something to load, so be it, it's okay. Don't just timeout and say "no messages" and "Live session messages can't load until OpenCode is back. The connection monitor is retrying every 10 seconds. Prompts archive, settings, and the server list still work in the meantime." and failed to fetch, all in one session over 3 minutes time. This is pure fucking nonsense. It wasn't like that before. Inspect git history and your memories to figure out what changes were done, and reason about it. THIS MUST BE FIXED. openportal must be a caching proxy for opencode. If you see msgid 1 in sesid 1, you cache it! You know it's there. Only when you hear from opencode AUTHORITATIVELY (not a fucking timeout or empty array due to a bug or something) that it's not there, should you update your cache and no longer display. Openportal MUST NOT be a dumb proxy where all shit gets forwarded to opencode, and if it's down or slow, openportal is slow. No. Maintain your own view of the world, and update it as opencode is giving you modifications. THIS APPLIES TO EVERYTHING. Projects list in sidebar. In progress status of session (derived from stuck detector, the most accurate source of status). Session title. Tool calls, Ai responses, user prompts. ALL THE SHIT MUST GO THROUGH OPENPORTAL AND BE CACHED FOR HIGH LATENCY SITUATIONS. Wherever user can submit things, it also goes to cache and stays there until reconciled with opencode, eg the user submitted message came back with message id = good.

Plus inline UI items:
> 1. Notification sounds dropdown for filename is enormous. it causes the text in first column to be multiline (7 lines wtf)
> 2. STUCK badge present but nothing actionable about it. stuck badge should be clickable, and offer action to unstuck it.

Design notes (architecture, multi-commit):
- 6679f61: caching proxy messages + opencode probe — removed the 3s Promise.race timeout in fetchAndCache, added stale-while-revalidate to loadFullMessages, single-flight INFLIGHT map, probe-cache.ts with UP=60s/DOWN=5s. /api/instance/self stops flapping to opencode-down on slow probes.
- faf3d24: caching proxy sessions list (sidebar) — new sessions-cache.ts module, mirrored pattern. Invalidates on SSE session.* events + /prompt + /command.
- 495e6a7: bootstrap (agents/config/providers) past-STALE_MS returns cached + background refresh instead of blocking + throwing. Never 502s a cached endpoint.
- ef5fe93: single-session GET reads from sessions-cache fast path. Modal opens instantly from cache, no opencode round-trip.
- a6cdbcf: STUCK badge clickable to dispatch unstuck via existing /api/stuck-detector/unstuck + sound dropdown SelectTrigger width capped at w-40 so long filenames don't blow out the row layout.
- 357c8e4 (this iteration): SQLite-backed persistence for messages-cache + sessions-cache via migration 0004 (messages_cache + sessions_cache tables, MAX_PERSISTED_SESSIONS=1000). setCachedMessages/setCachedSessions write memory + SQLite inline; getStaleMessages/getStaleSessions hydrate from SQLite on memory miss, populating the in-memory LRU so subsequent reads stay fast. Closes the deferred items at the bottom of the 6679f61 commit message ("SQLite-backed cache that survives openportal restart, append-only message semantics that never remove cached items based on a transient empty response"). Plus shrink guard: setCachedMessages/setCachedSessions refuse to overwrite a cached list with a SHORTER one - suspicious partial response per the authoritative-only invariant. Legitimate trims still work because invalidateMessagesCache/invalidateSessionsCache drop the row first; subsequent fetches repopulate from scratch with no shrink check. Plus frontend fix in routes/_app/session/$id.tsx:5270: "OpenCode is unreachable" panel only renders when `messages.length === 0` in addition to `opencodeUnreachable` so a loaded chat log (memory OR SQLite hydrated) no longer gets obscured by the panel. Remaining deferred (would ship if user still sees gaps): append-only per-message merge (today we replace the whole entry on shrink-passing writes; opencode never trims from the middle in practice) and bootstrap-cache.ts (agents/config/providers) SQLite persistence (memory-only today, smaller cold-load impact than messages/sessions).

### 55. File browser dir listing aside scrolls past viewport on desktop (DONE - 2bbc71a)

User prompt:

> file browser: I only see directories up to letter j, scroll past it...

Design notes:
- Root cause: aside had max-h-[50vh] for mobile + md:max-h-none for desktop. On desktop the cap was removed but no fallback height was set, so the aside took its CONTENT's natural height (= all entries stacked). Its own overflow-auto never triggered. Parent's overflow-hidden clipped the bottom of the aside.
- Fix: add md:h-full so aside takes parent's full height (limited by parent's overflow-hidden), then its overflow-y-auto kicks in when content exceeds.

### 56. Permalinks preserve ?server= across navigate() + highlight more visible + spec-matching comment (DONE - 695ae79 + 667b6d5)

User prompts (sub-items from #5/6 in PENDING):

> links in sidebar don't include server permalink. screen other places where server permalink missing.

> after clicking permalink ... must highlight very visibly the message permalinked.

> permalinks: click to copy and open... uhm, what, click to copy? click is open, not copy. right click copy, or on phone hold and copy, is how you copy. click to copy is nonsense.

Design notes:
- 695ae79: every navigate() call site that previously omitted search (cmd.tsx new-session + session-select + instances + servers, empty-state.tsx, app-sidebar.tsx home + servers + docs, app-sidebar-nav.tsx home, routes/servers.tsx 2 sites, session/new.tsx) now uses `search: (prev) => prev` to preserve ?server=. Session-palette select merges via `search: (prev) => ({ ...prev, focus: 'composer' })`.
- 667b6d5: permalink-pulse CSS keyframes bumped from peak alpha 22%/4px ring to 45%/6px at peak + held a sustained 25%/4px ring through 60% before fading. Duration 2.4s -> 3.6s. The stale block comment above MessagePermalinkTimestamp described an old "copy + open in new tab" click semantic; replaced with verbatim user-spec quote to prevent future agents from "restoring" the click-to-copy anti-pattern. Click semantics already correct in code: in-page click -> scroll + flashMessageHighlight (no nav); out-of-page click -> default <a> nav same-tab; right-click / long-press -> copy.

### 57. Stuck-detector multi-part dispatch: SSE independence + PUT /config audit + label rename + presets + SSE latency sidebar metric (ITEMs 1-5 from msg_e575eb73f) (DONE - 4e543bd + b6571bb; ITEM 1 + 4 + 5 verification-only)

User prompt (5-part dispatch summary):

> Multi-part stuck-detector portal-side work. ITEM 1 (ses_1aa08841d verification post-restart, no portal code). ITEM 2 (SSE-latency sidebar metric). ITEM 3 (settings UI labels + 'Set all to automatic' + 'Set all to passive' presets). ITEM 4 (verify stuck-detector SSE subscription stays alive when opencode unreachable). ITEM 5 (PUT /config wrapper sends full body + surfaces validation errors + refresh after save).

Design notes:
- ITEM 4: VERIFIED no code needed. stuck-detector-client.ts + stuck-detector-journal-client.ts both subscribe to 127.0.0.1:4098 directly with no gating on opencode reachability. Independent of opencode HTTP availability.
- ITEM 5: VERIFIED no code needed. updateStuckDetectorConfig already sends complete config object, server wrapper passes through plugin's validation errors to UI (toast.error), and globalMutate(KEY, body) refreshes SWR cache with canonicalized response.
- ITEM 3 (4e543bd): renamed CauseAction labels for self-documenting clarity: "Disable cause entirely" / "Just log (passive observer)" / "Automatic recovery (resumer)" / "Auto-bump (retry-overdue only)". New AUTOMATIC_PRESET + PASSIVE_PRESET constants. New 'Set all to automatic' + 'Set all to passive (log only)' buttons fire one atomic PUT carrying every cause's new action.
- ITEM 2 (b6571bb): per-server lastEventMs Map in indicator-broadcaster, stamped on every SSE frame. Exposed via getLastEventMs(serverId) + getAllLastEventMs(). New sseLatency field on /api/system-stats: { perServer: {<sid>: {lastEventMs, lagMs}}, worstLagMs }. Sidebar 'sse' row with color thresholds (<1s neutral, 1-30s warning, >30s danger). Tooltip carries exact band.
- ITEM 1: AWAITS user's next opencode-serve restart. Plugin-side already shipped scanDbStuckCauses pass in 65fbbf2; portal verification step happens once the new plugin code is live.

### 58. User-prompt accent brightness + 4px left stripe (DONE - 0df212d + a1d7336)

User prompt:

> Enqueue to end: make user prompts in chat log much brighter accent color. Current one can be barely distinguished from ai messages.

Design notes:
- 0df212d: bumped userBgClass from bg-accent/10 → bg-accent/30 (3x light-mode tint), dark:bg-accent/8 → /25, border-accent/50 → /80.
- a1d7336: added border-l-4 + border-l-accent so each user message has the canonical chat-UI left-stripe accent (Slack/Discord pattern) on top of the brightened body.

### 59. P0 cohort owner-routing across every runner-targeted command (CRITICAL CORRECTNESS) (DONE - 2fa0d94 + f26dcc3 + 7dd0b64)

User prompt (P0 from cohort-architecture dispatch):

> Today portal sends POST /session/<sid>/prompt_async to whichever opencode instance the user has selected as 'active server'. If a session is running on instance B (its owner) but the user's UI shows instance A as active, portal will deliver the prompt to A. A then spawns a SECOND runner for the same session, parallel to B's existing one. Outcome: Two concurrent assistant messages on the same session ID. Interleaved part writes -> garbled chat output, potential FK violations. Double model-API costs. opencode has no cross-instance prompt-routing mutex. The DB doesn't coordinate. THIS IS A REAL BUG, hits any user with multi-instance setups (tailscale + LAN + sandbox + docker). FIX: every prompt dispatch goes through a 'resolve owner' step: 1. Query plugin: GET 127.0.0.1:4098/verdicts/<sid>. 2. Read verdict.owner_instance_url. 3. If non-null: route POST /prompt_async to that URL, not the user-selected active-server URL. 4. If null (no current runner): route to user's selected active-server URL.

Design notes:
- 2fa0d94: new apps/web/src/server/lib/prompt-routing.ts exports resolveOwner(sessionId) which queries the plugin's authoritative aggregator at /verdicts/<sid> and parses owner_instance_url into {host, port}. 5s TTL cache so prompt bursts hit plugin once. Wired into pending-prompt-worker.ts + /prompt.ts + /command.ts. console.log records every rerouting decision.
- f26dcc3: same pattern applied to session.abort. Same bug class - aborts from non-owner instance no-op while runner keeps generating on owner.
- 7dd0b64: same pattern applied to session.summarize/compact. Compaction kicks off work on a specific instance; non-owner dispatch would spawn a second parallel compaction job. Now ALL runner-targeted opencode commands route via cohort owner: session.promptAsync, session.command, session.abort, session.summarize. DB-write commands (delete/archive/unarchive/revert/fork) stay on user's active-server since shared SQLite means any instance writes propagate.
- DEFERRED: per-cohort plugin URL (today everything goes to 127.0.0.1:4098; eventually plugin will run per cohort). SDK auth handoff if owner instance requires non-default auth (today everything is loopback unauthenticated so getOpencodeClient works for any port portal can reach).

### 60. P1 cohort registry + sidebar partitioning (DONE - 2d506bc + d5d2eeb)

User prompt (P1 from cohort-architecture dispatch):

> NEW CONCEPT: instance vs server (cohort). Today /servers conflates 'running opencode process' with 'logical server group'. Split the vocabulary: Instance = single opencode-serve process. Identified by <host>:<port>. Server (cohort) = logical group of instances sharing the same SQLite DB. One PRIMARY (user-picked, used for default operations like /messages routing when ownership doesn't apply), rest are SECONDARY (used for failover, SSE subscriptions, sidebar-stats aggregation). Owner = the instance within a cohort currently holding the live runner for a given session.

Design notes:
- 2d506bc: new apps/web/src/server/lib/cohort-registry.ts polls plugin GET /workers every 30s, parses each worker {workerID, instanceUrl, lastSeen} into typed CohortWorker with parsed host+port. Exposed via getCohortSnapshot() + new Nitro plugin cohort-poller.ts that starts the loop on server boot. New GET /api/cohort endpoint returns the snapshot for frontend consumers.
- d5d2eeb: new apps/web/src/stores/cohort-store.ts SWR hook + sidebar-system-stats.tsx partitions opencodeProcesses into 'cohort×N' (matching ports in cohort) + 'other ocs×M' (different cohorts on host - sandbox-local, docker, ad-hoc). Sidebar-stats cohort metric no longer inflated by unrelated opencode-serve instances per user spec.
- Remaining P1 items (deferred for explicit scope direction): /servers UI redesign (cohort grouping + primary selector), routing abstraction (cohort handle instead of instance URL), instance/server/cohort vocabulary refactor.

### 61. Bulletproof prompt history: localStorage first bastion + reconciliation (PHASES 1+2+3 DONE - 142632f + fc37d72 + 52596da + 7cabf07)

User prompt (verbatim):

> End of queue: inspect draft clearing code. I once submitted a prompt and it went nowhere. It showed on the chat log for a while. But not in prompt history. Clicking the button should ALWAYS put it in the history. If message gets lost somehow in routing, whatever, it still must be in prompt history. I've an idea. Local storage as the first bastion for prompt history. It goes there. Then send to openportal backend. Only when openportal backend accepts it and gives us an ID back (means it was saved), then frontend can clear it from local storage. If for some reason there's leftover local. Storage entries, they should be shown in between "legit" backend derived prompts. And on prompt history render, when front end notices it, should send it to backend as "history only entry, not a prompt to submit". So it's persisted. In prompt history list it should show as "not sent" or some other descriptive label. But it needs to have all the Metadata eg datetime is when user clicked submit prompt. Make it bullet proof. No prompts, ever, must be lost. Even if openportal is down, for a brief moment or for hours!

Phase 1 (142632f, DONE): localStorage capture before fetch.
- New `apps/web/src/lib/pending-prompts.ts` single-key store (`openportal-pending-prompts-v1`) holding `PendingPromptEntry[]` with full metadata: `{localId, sessionId, port, text, model, agent, variant, attachmentsCount, submittedAt, lastError, attempts, kind, commandName?, commandArguments?}`.
- Main composer submit at `$id.tsx` wrapped: `recordPendingSubmission` IMMEDIATELY before fetch; on 2xx -> `clearPendingSubmission`; on failure -> `recordFailedAttempt` with error text + rethrow.
- Cross-tab sync via `storage` event. Defensive try/catch on read+write so SSR/private-mode/quota-exceeded degrade gracefully.

Phase 2 (fc37d72, DONE): /prompts UI surface.
- `usePendingSubmissions()` hook subscribes to localStorage changes.
- New `PendingSubmissionsBanner` at top of /prompts scrollable area, shown when count > 0. Per-entry row: relative age, session-id prefix, attempt count, last-error tooltip, text (truncated 200), Drop button. "not sent" pill in warning yellow.

Phase 3a (52596da, DONE): wrapped 2 more submit sites with the record/clear pattern — new-session create at `new.tsx`, sidebar runTool helper at `app-sidebar-nav.tsx`. The retry-only sites (`$id.tsx:4634` stuck-busy auto-retry) are intentionally skipped since the original submit already captured the prompt; wrapping would dupe entries.

Phase 3b (7cabf07, DONE):
- `PromptStatus` type extended with `history-only` (`prompt-archive.ts`). `listPendingPrompts` already filters by `status='pending'` so the worker auto-ignores history-only rows.
- New POST `/api/prompts/persist-orphan` endpoint (`apps/web/src/server/prompts/persist-orphan.post.ts`) takes a PendingPromptEntry-shaped body and archives via `archivePrompt` with `status='history-only'`. Validates sessionId+port+text non-empty.
- Render-time reconciler in `PendingSubmissionsBanner`: on every render, scans entries older than ORPHAN_RECONCILE_AFTER_MS (60s) and POSTs them to `/persist-orphan`. `reconcileInFlight` Set prevents duplicate posts. On 2xx, the localStorage entry is cleared — entry is now durably in backend SQLite, surviving browser cache clears, multi-device, hours of openportal downtime.

Phase 3c (last sub-task, ALSO DONE - question-fallback wrap):
- `$id.tsx:870` question-fallback prompt wrapped with the same record/clear pattern. The remaining unwrapped submit site is `$id.tsx:4634` (stuck-busy auto-retry), which is portal-initiated automated retry of a prompt that was ALREADY captured during the original user submit; wrapping would duplicate the localStorage entry.

End-to-end flow now BULLETPROOF:
1. User clicks Submit -> `recordPendingSubmission` writes to localStorage IMMEDIATELY. Even if browser tab crashes 1ms later, the entry survives.
2. fetch `/api/prompt`. 2xx -> `clearPendingSubmission`. Failure -> `recordFailedAttempt` records error + attempt count.
3. `/prompts` banner shows surviving entries as "not sent" pill.
4. After 60s, render-time reconciler POSTs orphan to `/persist-orphan` which archives `status='history-only'`. localStorage entry cleared. Row is now in backend SQLite. Visible in `/prompts` forever, surviving browser cache clears, multi-device, hours of openportal downtime.

User invariant met verbatim: "No prompts, ever, must be lost. Even if openportal is down, for a brief moment or for hours!"

### 62. Session info modal: incremental rendering with per-field spinners (DONE - d7a7d9f)

User prompt:

> Session info modal: instead of having to wait for any info to show, show immediately all that is already known, and each value that needs an update from server, an individual spinner as a value, before it populated.

Design notes (d7a7d9f, DONE):
- Replaced the all-or-nothing `isLoading` gate that blocked the entire body behind a single "Loading session info..." spinner with three independent per-source loading flags:
    sessionPending  : sessionsLoading && !sessions
    messagesPending : messagesLoading && (!messages || messages.length === 0)
    modelPending    : messagesPending || (providersLoading && !providersData)
- `Field` component extended with optional `loading?: boolean` prop. When loading and no value yet, renders a small inline `<Loader className="size-3" />` instead of the value. Each field's loader clears independently as its source lands.
- Field <-> source mapping:
    Title / Session Created / Last Activity     -> sessionPending
    Provider / Model / Context Limit            -> modelPending
    Messages / *Tokens / Usage / Cost / Cache /
        User+Assistant counts                   -> messagesPending
    Session ID                                  -> never loading (route param)
    McpSection / ExportSection                  -> own internal loading
- Combined with the sessions-cache fast-path (commit ef5fe93), most fields are already populated from cache when the modal opens, so even the spinners are typically short-lived blips.

### 63. SQLite-persisted caching proxy + ERR_INSUFFICIENT_RESOURCES spam fix (DONE - 357c8e4 + cf8e96e)

User prompts (chained, all about the same caching-proxy directive plus its follow-up regression):

> Shit is totally destroyed when opencode has high latency 502 bad gateway all the fucking time. ... openportal must be a caching proxy for opencode. If you see msgid 1 in sesid 1, you cache it! ... Only when you hear from opencode AUTHORITATIVELY (not a fucking timeout or empty array due to a bug or something) that it's not there, should you update your cache. ... THIS APPLIES TO EVERYTHING. Projects list in sidebar. ... All shit must go through openportal and be cached for high latency situations.

> index-DMCrwyIF.js:58 GET /api/opencode/4096/session/.../messages net::ERR_INSUFFICIENT_RESOURCES ... a spam of messages, in tens per second. /api/state/last-viewed in 20-40 per second. fix asap.

Design notes:

- 357c8e4 (SQLite persistence): Migration 0004 adds two tables: `messages_cache(session_id, fetched_at, message_count, messages_json)` keyed per-session, and `sessions_cache(port, fetched_at, session_count, sessions_json)` keyed per-port. messages-cache.ts + sessions-cache.ts now write memory + SQLite inline on every `setCachedMessages` / `setCachedSessions`; `getStaleMessages` / `getStaleSessions` hydrate from SQLite on memory miss and populate the in-memory LRU so subsequent reads stay fast. MAX_PERSISTED_SESSIONS=1000 LRU on disk (oldest fetched_at evicted). Shrink guard: setCachedMessages/setCachedSessions refuse to overwrite a cached list with a SHORTER one (suspicious partial response per the authoritative-only invariant). Legitimate trims (revert, delete, session.deleted SSE event) flow through invalidateMessagesCache/invalidateSessionsCache which drop the SQLite row + clear the throttle map so the next set writes fresh. Frontend fix in `routes/_app/session/$id.tsx`: "OpenCode is unreachable" panel only renders when `messages.length === 0` in addition to `opencodeUnreachable`, so a loaded chat log (memory or SQLite-hydrated) is never obscured.

- cf8e96e (spam regression hotfix): Two independent failure modes ganged up post-357c8e4. (a) The 12,802-message session's messages_json blob is ~35 MB; without throttling, SWR poll + SSE-driven fetchAndCache stacked tens of MB of SQLite writes per second, blocking the Bun event loop and exhausting the browser's per-host pool. Fixed with `PERSIST_THROTTLE_MS = 30_000` per cache key (in-memory LRU still updates on every set; SQLite write fires at most once per 30s per session/port). (b) `useMarkViewed` returned a fresh closure on every render so the useEffect at `$id.tsx:3508` (deps include the function ref) re-fired every render — 20-40 POSTs/sec to `/api/state/last-viewed` on busy sessions. Fixed by wrapping `useMarkViewed` + `useMarkManyViewed` in `useCallback` (stable ref across renders) AND adding `MARK_VIEWED_THROTTLE_MS = 5_000` per sessionId so even effect re-fires hit a cheap Map-lookup early-return.

Remaining deferred (would ship if needed): append-only per-message merge on shrink-passing writes (opencode never trims from the middle in practice; explicit invalidate covers revert/delete); bootstrap-cache.ts (agents/config/providers) SQLite persistence (memory-only today, much smaller cold-load impact than messages/sessions).

### 64. Session-level errors surface in chat log (DONE - 9ce45c7)

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

### 65. Compaction events render as chat log entries (DONE - e99fc88)

User prompt (verbatim):

> enqueue after current: ses_229d7083fffem6lkaEj69adZ7H when viewed in opencode web ui, i see a lot of compaction events. openportal does not show them at all. every compaction event trigger should be seen as a chat log entry.

Design notes (e99fc88, DONE):
- Verified on `ses_229d7083fffem6lkaEj69adZ7H`: 156 compaction parts in the message stream. Each is a user-role message with a SINGLE `type:"compaction"` part (shape `{id, sessionID, messageID, type:"compaction", auto: bool, overflow?: bool, tail_start_id?: string}`). `hasVisibleContent` returned false for those messages (no text/tool/file part), so they were filtered out before reaching `MessageItem`.
- `isCompactionPart` predicate added alongside `isToolPart` / `isFilePart`. `CompactionPartShape` captures the extra fields opencode emits but `@opencode-ai/sdk@1.14.50`'s `CompactionPart` is missing (overflow + tail_start_id).
- `hasVisibleContent` now includes `hasCompactions`; `compactionParts` derived in `MessageItem` alongside toolCalls/fileParts.
- `CompactionEventRow` component renders a horizontal dashed divider with a centered chip: `ArchiveBoxIcon` + "Auto-compaction" / "Manual compaction" label + optional "overflow" pill when `overflow=true`. Tooltip explains the full state (auto/manual, overflow, tail_start_id).
- Render site: after permission decisions, before the errorDescription `ErrorBox` — so the marker sits at the chronological end of the message but above any failure banner.
- Chat log now matches opencode web UI parity for compaction visibility.

### 66. Session info modal: opening should produce a permalink (DONE - in tandem with #71)

User prompt (verbatim):

> enque as next tasks: opening session info modal does not result in a permalink.

Design notes:
- Portal AGENTS.md `Everything is a permalink` section already says Session Info modal should use `useHashOpen("info")` at `/session/<id>#info`. User reports the hash is NOT appearing when the modal opens — either the modal stopped using `useHashOpen`, or `useHashOpen` regressed and stopped writing to `location.hash`.
- Investigation steps: find current open-the-modal call site (search for "Session info" / SessionInfoModal openers). Verify it routes through `useHashOpen("info")`. If it's calling a separate state hook (useState), swap to `useHashOpen`. Cross-check the close path too — Esc / backdrop / X-button should `history.back()` or remove the hash so back-navigation lands on the prior URL, not on a sibling `#` state.
- Acceptance test: open the modal → URL gains `#info` → reload the URL → modal opens automatically → click X → URL drops `#info` → back button works as expected.

### 67. Session info modal: expose owner/runner instance info (DONE - to be filled by commit hash)

User prompt (verbatim):

> in session info modal, expose information about the owner/runner of that session. the instance that claims that owns the dispatch of it.

Design notes:
- Cohort-registry plus stuck-detector plugin's `/verdicts/<sid>` are the authoritative sources for "which opencode instance owns this session right now". `apps/web/src/server/lib/prompt-routing.ts` already resolves the owner instance URL per session (2fa0d94); same data should be surfaced in the Session Info modal.
- New `Field` rows in the modal: **Owner instance** (host:port from verdict.owner_instance_url, or "—" when verdict has no owner) and **Cohort** (which configured server the owner instance belongs to, derived from the cohort-registry snapshot).
- Loading state per Diagnostics protocol: render `<Loader />` until the verdict + cohort fetches resolve; show "(no runner)" rather than spinner if the verdict authoritatively reports no current runner.
- Don't add a NEW API endpoint; reuse the existing `/api/cohort` (`d5d2eeb`) and the existing stuck-detector probe endpoint that frontend already calls. New owner-info field on `/api/instance/self` is also fine if needed.
- Backend invariant: when the plugin is unreachable, fall back to the user-selected active-server URL with a "(plugin offline; showing active server)" label so the field is never blank.

### 68. Prompt-submit transient disappear+reappear bug; distinct badges per phase (DONE - to be filled by commit hash)

User prompt (verbatim):

> enqueue before ^K work: there's a brief moment when prompt is submitted -> sent to opencode -> SOMETIMES: disappears from chat log -> reappears again as queued. OR maybe, i can't recall prompt is submitted -> sent to opencode -> queued -> SOMETIMES: disappears from chat log -> reappears again. i can't tell which one, but one of them for sure. MUST be aware that opencode has latency and sometimes a list of messages comes back and it's out of date with our submission. so openportal must ALWAYS be aware of that, and keep anything that opencode confirmed as received, but not yet coming back to us with a certain badge. do not reuse "queued". each situation must be distinct from each other. tooltip on badge of each situation should explain what each situation means.

Design notes:
- Root cause hypothesis: messages from opencode come back BEFORE the user's submission has been flushed to opencode's DB. The virtual prompt entry (from prompt-archive) renders, then a fresh `/messages` poll returns an older snapshot without it, then the next poll catches up. SWR `keepPreviousData` doesn't help because the merge logic replaces the array; the virtual-prompt-merge in `messages.ts` (`loadFullMessages`) needs an additional gate: "if a virtual prompt has a confirmed opencode messageID we already saw in EARLIER polls, keep it on screen even if THIS poll's snapshot is missing it".
- Define explicit per-phase badges. NO reuse of "QUEUED" beyond the original meaning. Proposed taxonomy (each MUST have a distinct visual style + tooltip):
  - **DRAFT** (gray): localStorage-captured only; not yet POSTed to openportal. Tooltip: "Captured in your browser. Not yet sent to OpenPortal."
  - **PORTAL-ACK** (light blue): openportal accepted, archive row created, not yet POSTed to opencode. Tooltip: "OpenPortal accepted your prompt. About to send to OpenCode."
  - **SENT-TO-OPENCODE** (sky-blue, no animation): pending-prompt-worker received 2xx from opencode's `/prompt_async`. Tooltip: "OpenCode accepted the prompt. Waiting to start the assistant turn."
  - **QUEUED** (existing muted-gray pulse): opencode has it queued behind another running turn (mode === "queued" or pendingPromptIds detected on the indicator). Tooltip: "OpenCode is busy with an earlier turn. Your prompt is queued."
  - **RECONCILING** (yellow): we have the prompt locally + sent confirmation but a recent `/messages` snapshot is missing it. Tooltip: "OpenCode confirmed the submission but its latest snapshot hasn't caught up yet. Holding the message visible to avoid blinking it away."
- Backend change: track the highest "last seen" opencode messageID per session in memory; when a fresh `/messages` response is MISSING a virtual prompt's opencode messageID that was in an earlier response within N seconds (say 30s), keep the virtual visible with phase=RECONCILING instead of dropping it.
- Frontend change: virtual-message renderer picks badge from `_pending.phase` map; styles + tooltips defined in one constant table so tooltip text never drifts.

### 69. Ctrl+K palette: match by full or partial session ID (DONE - to be filled by commit hash)

User prompt (verbatim):

> after: ^K should also work by session id, e.g. i paste ses_229d7083fffem6lkaEj69adZ7H and my match is the session with that session id.

Design notes:
- Existing prefix-match in `cmd.tsx rankSessions` was shipped at `2eba984` (entry #36 — "Quick search by partial session ID"). User reports it doesn't match for FULL pasted session IDs. Investigate: likely the matcher's prefix branch requires query.length < session.id.length, or the matcher only triggers on `ses_` prefix and not the full ID.
- Acceptance: pasting `ses_229d7083fffem6lkaEj69adZ7H` matches THAT session (no other). Pasting `ses_229d7083f` matches the same session as a prefix. Pasting `ses_` lists all sessions sorted by activity.

### 70. Fork-to-different-project: fork stayed in source dir (DONE - to be filled by commit hash)

User prompt (verbatim):

> then: forking into a different project did not result in a fork moved to the target project/directory. inspect why.

Design notes:
- Section L (entry #1 in PENDING) shipped the Fork dialog with project picker. User reports the fork backend isn't actually relocating the forked session to the chosen target directory — it stays in the source session's directory.
- Inspect `/api/opencode/[port]/session/[id]/fork` handler: opencode's `/session/{id}/fork` accepts the body but session.directory may be IMMUTABLE per the opencode public API (see prompt-archive.ts:91-93). If immutable, forking + then move-local-style relocation is required. Confirm with opencode SDK.
- Likely fix: chain fork → moveLocal(forkId, targetPath) when targetPath differs from source. Reuse the existing move-to-project endpoint plumbing (move-local.ts + the section M backend). On success, route browser to the new session in the new directory.

### 71. Right hamburger #menu hash should NOT be a permalink/pushState (DONE - shipped with #66)

User prompt (verbatim):

> enqueue at the end: #menu for right hamburger being opened should not be a permalink / pushState entry. this is because when i go to burger > prompt history, then go back, i want to go back to my current session, and not to open the burger.

Design notes:
- The "everything is a permalink" rule has an exception for transient UI surfaces that are NOT shareable state: hamburger menus, dropdown popovers, mode toggles. These should NOT pollute browser history because back-button semantics expect to return to the previously meaningful URL, not to a transient toggle.
- Find the right-hamburger menu open/close handler. If it currently uses `useHashOpen("menu")` or otherwise pushes `#menu` to history, swap to a pure-React-state toggle (`useState` or a zustand store). Verify back-button on `/session/<id>?...` ← `/prompts` round trip ignores the menu state.
- Update portal AGENTS.md `Everything is a permalink` section to call out this exception list explicitly so future agents don't try to re-add `#menu` permalink.

### 72. Prompt history page: slow cold load; render openportal data immediately + spinner per opencode-dependent field (DONE - to be filled by commit hash)

User prompt (verbatim):

> enqueue at the end: burger > prompt history takes LONG to load. it is almost entirely openportal only data. so why is that? remember the rule: when something is loading, show an indication. but the entire screen isn't even changing to prompt history window for 15-30 seconds. if there is any specific opencode api that prompt history needs, well, it should spinner that piece of data, and show everything else that's known right away. this is the base rule of this project, if unclear update agents.md.

Design notes:
- `/prompts` route loads from openportal SQLite (FTS5 prompt archive). That's 100% local data; should render instantly. The 15-30s delay implies a blocking opencode call in the page load path — likely `useSessions()` to materialize session titles, or providers/agents for filter chips.
- Fix per the existing Loading-feedback rule (portal AGENTS.md): render the prompts list IMMEDIATELY from the archive endpoint; per-row session-title hydration uses an inline `<Loader />` until the per-session lookup resolves. NEVER block the route render on opencode-data-dependent fields.
- Audit `/api/prompts/...` server-side: if the handler calls into the opencode SDK at all, defer those calls to background fill rather than blocking the response.
- Portal AGENTS.md `Loading feedback` rule already says "keep the previous data visible during silent refresh (keepPreviousData: true) so the spinner only appears on cold load, not on every revalidation" and "Lists MUST show a spinner row (or skeleton placeholders) until the response lands". Reinforce that the rule applies AT ROUTE-LOAD TIME too: a route MUST render its own data within one paint, opencode-dependent enrichment fields render with their own per-cell spinners.

### 73. Analysis request: SSE reconnection behavior during OpenPortal restart / opencode unavailable (DONE - analysis only - User Review)

User prompt (verbatim):

> in an event of "OpenPortal updated - reload to upgrade" alert - when openportal restarts - what happens to the frontend when i have an active session opened, one that is working, and supposedly has an active sse stream?
> or when 'opencode not available'
> will it miss the updates in between? say last i saw was message in sequence number 5, then something happened in the meantime, and now the latest would be number 10 in sequence. will openportal receive everything in between?
> I've noticed updates very flakey at times, and i sometimes f5 to see if real progress happened.

Design notes:
- Analysis-only task per portal AGENTS.md "Analysis / deep-explanation requests" protocol. No code changes.
- Full investigation persisted to `ai-analysis-requests/SSE_RECONNECTION_BEHAVIOR.md`.
- TL;DR: Three SSE streams (`/api/indicators/stream`, `/api/opencode/<port>/event`, `/api/stuck-detector/events/stream`). NO sequence numbers, NO `Last-Event-ID`, NO server-side replay. Events in the gap are permanently lost on the wire.
- Convergence mechanisms: (1) `/api/indicators/stream` sends a fresh `snapshot` frame on every reconnect with current state, scoped to the consumer's filter. (2) `useConnectionMonitor` fires global `mutate(() => true)` on `down → connected` transition, refetching every SWR key. Net: user sees correct final state, but loses intermediate trajectory (token-by-token deltas, transient busy badges).
- "OpenPortal updated" banner = 60s poll of `X-OpenPortal-Build` header in `use-build-mismatch.ts`. Polling, not event-driven. One-way trapdoor (never resets). No auto-reload.
- "OpenCode unavailable" banner = 10s probe of `/api/instance/self` reading `health.opencode` field. 2-consecutive-fail threshold before flipping to openportal-down. 15s per-probe timeout (note: this differs from the AGENTS.md "5s timeout" claim; the actual code uses 15_000ms — worth a documentation fix in a separate todo).
- F5 flakiness explanation: `EventSource` can be silently dead (no events arriving) while `/api/instance/self` still reports connected. The monitor sees no state transition, fires no global refetch, and SWR sits on stale data. F5 = fresh EventSource + fresh SWR cache. No watchdog detects this case today.
- Recommended follow-up (NOT auto-queued; for user review): add a per-stream heartbeat watchdog in `use-indicators.ts` and `use-event-stream.ts`. Track last-event-received timestamp; if it exceeds 2x the server's heartbeat interval (~60s for indicators), force-close + reopen + fire `mutate(() => true)`. ~50 lines. Closes the silently-dead-socket gap that F5 currently fixes.
- AGENTS.md "Connection resilience" section says probe timeout is 5s; actual code at `use-connection-monitor.ts:7` is `PROBE_TIMEOUT_MS = 15_000`. Doc-vs-code drift; worth a separate quick-fix entry if the user wants the docs aligned.

### 74. Session prompt directory routing (bash cwd wrong) - openportal bug, fix on worktree (DONE - <COMMIT-SHA>)

User prompt (verbatim):

> ses_199f94180ffeYBjaI0fuz5pfGw
> look at this sessions's prompt and AI tool calls:
>
> ```
> portal: Sync chat prompts to navbar highlight
>
> make the user prompts in chat log the same color as the highlighted session in navbar when active.
> like this color-mix(in oklab,var(--primary)15%,transparent)
>
> remember to reuse components/definitions. don't hardcode.
>
> perform on a worktree. merge to master when ready.
>
>
> 15:43
> $
> bash pwd && ls -la
> # Check current directory
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/nowaker/ 2>&1 | head -50
> # List nowaker projects
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/nowaker/opencode-tools/ 2>&1
> # List opencode-tools
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/ai-workspace/ 2>&1
> # List ai-workspace
>
>
> 15:43
> $
> bash ls /home/nowaker/projekty/webapps/ 2>&1
> # List webapps
>
>
> 15:43
> Server is idle - prompt accepted but generation never started.
> ```
>
> why does it pwd, then try to find current project? when the session starts in /home/nowaker/projekty/webapps/portal? doesn't it know?  if not, why? what's wrong? opencode's default behavior, or openportal submitting a session incorrectly? if an openportal bug, fix on a worktree, merge to master afterwards.

Design notes:
- Diagnosis: opencode's workspace-routing middleware in `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts` resolves the per-request `InstanceContext.directory` via `defaultDirectory(request, url)`: URL `?directory=` query param OR `x-opencode-directory` header OR `process.cwd()`. The session looked up by id only contributes `workspaceID`, never `directory`. So sessions with `workspace_id = NULL` (the user's setup - configless mode, no remote workspace) fall through `defaultDirectory()` and land on opencode's `process.cwd()` = `/home/nowaker/projekty` (from systemd `WorkingDirectory=%h/projekty`). The shell tool's cwd is `instanceCtx.directory` so `pwd` returns the wrong directory and the AI gets confused about which project it's working in.
- Root attribution: openportal bug - the API contract from opencode is "every session-scoped POST must declare its directory" and openportal was only honoring it on session create, not on subsequent /prompt and /command POSTs. opencode itself could be argued to need a fallback to `session.directory` but that's an upstream change not authorized by this prompt.
- Fix: new helper `resolveSessionDirectory(port, sessionId)` in `apps/web/src/server/lib/opencode-client.ts` looks up `session.directory` via GET `/session/<id>` (which is "local action" in opencode's RULES so it doesn't itself need a directory header - breaks the chicken-and-egg cycle), caches 5min (immutable for session's lifetime in practice), best-effort fallback to `undefined`. Threaded into three session-scoped dispatch paths:
  - `apps/web/src/server/opencode/[port]/session/[id]/prompt.ts` - direct dispatch fallback + background abort.
  - `apps/web/src/server/plugins/pending-prompt-worker.ts` - background delivery (the path the bug reporter actually hit).
  - `apps/web/src/server/opencode/[port]/session/[id]/command.ts` - slash-command dispatch (v2 SDK uses flat `directory` param).
- SDK support verified at `@opencode-ai/sdk@1.2.27`: `SessionPromptAsyncData.query.directory` (v1), `SessionCommandData.query.directory` + flat `directory` parameter (v2). Both endpoints have always accepted the directory; openportal just wasn't passing it.
- Full investigation at `ai-analysis-requests/SESSION_PROMPT_DIRECTORY_ROUTING.md`.
- Worktree path: `~/projekty/webapps/portal-fix-session-directory` (branch `fix-session-directory-routing` off `main-nowaker` at `6b5e4c7`). Built bundle hash `BQPhedP4`. TypeScript clean on touched files (pre-existing `command.ts:61` `opencodeMessageId` use-before-declare bug confirmed on main-nowaker, NOT introduced by this fix).
- Verification plan: after deploy via `scripts/deploy.sh`, send a prompt asking the AI to run `pwd` from any active session; expect cwd = session's project worktree (not `/home/nowaker/projekty`).
- Deferred follow-ups (NOT in this fix's scope, separate todos):
  - Sweep other session-[id]/*.ts handlers (abort.ts, compact.post.ts, messages.ts SSE, todo.ts, revert.ts, archive.post.ts, fork.post.ts, export.get.ts, etc.) for the same directory threading. Most are GET requests where the wrong directory doesn't surface user-visibly, but the pattern should be consistent.
  - File upstream opencode issue/PR proposing `session.directory` as the fallback before `process.cwd()` in `workspace-routing.ts` `defaultDirectory()`. Would fix this class of bug for every opencode client, not just openportal.
  - Pre-existing `command.ts:61` use-before-declare bug (`opencodeMessageId` referenced in `archivePrompt({...})` payload BEFORE the `const opencodeMessageId = ...` declaration on line 69). TypeScript flagged it but it doesn't crash at runtime because of hoisting + the archive being fire-and-forget. Worth a separate one-line fix entry.

---

### 75. New-session composer drafts persist per directory + sidebar indicator (DONE - to be filled by commit hash)

User prompt (verbatim):

> going to new session eg https://portal.desktop.ts.nowaker.net:8443/session/new?server=srv-2dy1srwz&directory=%2Fhome%2Fnowaker%2Fprojekty%2Fwebapps%2Fportal
> then going to settings
> then going back
> does not preserve my input field.
> new session drafts must be preserved too, per project/directory they are about to be created it.
> if a given project/directory has a new session draft, an indicator must show that on the project/directory level. and when i click + it must be restored.
> mechanism equally the same as for drafts for existing session. don't code duplicate, reuse.ping

Follow-up user prompt (verbatim):

> fix on a worktree. merge to master when done.

Design notes:
- Existing per-session composer drafts live in `localStorage["opencode-composer-draft:<sid>"]` with helpers `getDraftKey/readDraft/writeDraft` privately defined in `routes/_app/session/$id.tsx` (lines 3329-3424) and `sessionHasDraft` (publicly) in `lib/session-indicators.tsx`. The DRAFT_KEY_PREFIX constant is duplicated across both files - mild existing tech debt, this entry consolidates it.
- Plan: synthetic "session ID" of `new:<directory>` for the new-session composer. The full localStorage key becomes `opencode-composer-draft:new:<directory>` - reusing the existing readDraft/writeDraft/sessionHasDraft functions verbatim by passing the synthetic key. Zero new storage helpers needed.
- Step 1: move `getDraftKey/readDraft/writeDraft/DRAFT_MIN_BYTES` from `$id.tsx` into `lib/session-indicators.tsx` (single source of truth alongside the existing `sessionHasDraft`); add `newSessionDraftKey(directory)` returning `"new:" + directory`. `$id.tsx` switches to imports - no behavior change.
- Step 2: `routes/_app/session/new.tsx` adds a `useEffect([draftKey])` that loads on mount/directory-change and persists on cleanup. Save semantics mirror $id.tsx: desktop = on every keystroke (immediate); mobile = 5s debounce; `DRAFT_MIN_BYTES=10` clobber-guard for cross-tab safety. Submit success path calls `writeDraft(draftKey, "")` to clear. Also marks `hasUserEditedRef.current = true` after a restored draft so the composedAutoPrompt effect doesn't override the user's content.
- Step 3: sidebar indicators - `components/app-sidebar.tsx` ProjectGroup aggDraft (line ~257) and `aggregateNodeStatus` (line ~1066) also check `sessionHasDraft(newSessionDraftKey(directory))`. New-session draft indicator must show even when the project is EXPANDED (no session row represents it, so cascading-suppression on expand doesn't apply). `components/sidebar-rail-layout.tsx` aggregateBinSignals (line ~208) gets the same check for `bin.dir`.
- Skip BroadcastChannel cross-tab sync for new-session drafts in v1 - the controlled-textarea pattern in new.tsx fights the existing `smartPostSubmitClear` mutation path. v1 just clears via setText("") after submit in the same tab. Other-tab clearance is a v2 if it becomes a friction point.
- Worktree: branched off `main-nowaker` as `new-session-drafts` at `~/projekty/webapps/portal-new-session-drafts`. After verification, merge to `main-nowaker` and deploy via `scripts/deploy.sh`.

---

## [Q4] SESSION_WEDGED_BANNER decision (Q-DEFERRED)

User prompt:

> Session may be wedged - OpenCode reports busy but no streaming progress. Abort + retry / Where is this coming from? Stuck detector or some less reliable openportal heuristic? If op, then it's probably not accurate? Provide analysis in Ai requests docs thing. Add todo for me to decide later.

Status: ANALYZED, awaiting user decision. Full analysis at `ai-analysis-requests/SESSION_WEDGED_BANNER.md`. Source: portal local heuristic in `routes/_app/session/$id.tsx:3706-3717` (5min wall-clock + isAssistantBusy + isServerBusy). NOT the stuck-detector plugin — pre-dates plugin integration.

4 options for user to pick from:
1. Drop the local heuristic entirely; rely solely on stuck-detector plugin verdicts.
2. Invert priority: plugin verdicts override the local heuristic when both fire.
3. Raise the threshold (5min → 15min) to reduce false-positives on legitimately-slow operations.
4. Add a streaming-delta probe: only fire the banner if NO streaming bytes received in the last N seconds.

---

## Q-DEFERRED (open questions awaiting user input)

- **Q1**: WebRTC for plugin internet access — propose an approach? (See PENDING #14)
- **Q2**: L7 `?scope=` URL-param permalinks — concrete use-case example needed before implementing. (See PENDING #15)
- **Q3**: OpenPortal as offline cache — user explicitly deferred; await reactivation. (See PENDING #16)
- **Q4**: SESSION_WEDGED_BANNER source + 4 options — analyzed in `ai-analysis-requests/SESSION_WEDGED_BANNER.md`. (See PENDING [Q4] above)

---

## ARCHITECTURE REFERENCE

Full directive lives at [`ai-analysis-requests/STUCK_DETECTION_INCORPORATION.md`](ai-analysis-requests/STUCK_DETECTION_INCORPORATION.md) (`d8d52a5`).

Architecture docs in `ai-analysis-requests/`:
- `COMPETITOR_ANALYSIS.md`
- `COST_DISCREPANCY_INVESTIGATION.md`
- `FEATURE_VALIDATION_REPORT.md`
- `MCP_STATES_AND_AUTH.md`
- `MESSAGE_ACTIONS_AUDIT.md`
- `OFFLINE_CACHE_DESIGN.md` ← the deferred offline mode design (PENDING #16)
- `OPENCODE_COMPAT_BRIDGE_DESIGN.md`
- `PROMPT_SUBMISSION_STATE_MACHINE.md`
- `SLASH_COMMANDS.md`
- `STUCK_DETECTION_INCORPORATION.md`

Plugin endpoints at `127.0.0.1:4098` (loopback, no auth):
- `GET /verdicts` — snapshot map<sessionID, Verdict>.
- `GET /verdicts/stream` — SSE deltas.
- `GET /workers` — registered opencode instances.
- `GET /config` — current stuck-detector config.
- `PUT /config` — replace config (whole document).
- `POST /unstuck/:sid` — dispatch recovery, body `{ cause? }`.
- `GET /actions?since=N&limit=N` — journal pagination.
- `GET /actions/stream?since=N` — journal SSE (LIVE on opencode-tools master `c8f181e+`).

opencode-tools master tip: `f38233b` (clean-session improvements). Recent CLIs all flattened to repo root. `move-local --target` auto-resolves project_id vs worktree path; `clean-session --project` reuses `moveLocal()`; `dump-user-messages --filter` + slash-command awareness shipped.

This session was MOVED from `ai-workspace` (project_id `dd569a167576e0b40276633d8d9ebc7eb58a6f8d`) to `webapps/portal` (project_id `e99d5e0eb7be2fe688ff7dd54f9daf04e5e8426f`) via `move-local --target ~/projekty/webapps/portal --allow-in-flight`. Snapshot tree relocated.

Worker-instance ID format: `<host>-<pid>-<port>` (e.g. `nwkr-desktop-165697-4096`). Section G subscribe-to-everything cache may need to add a mapping to portal's `serverId` (`srv-xxx`) — verify in `apps/web/src/server/plugins/session-prefetcher.ts`.

---

## CANCELLATION-ANALYSIS NOTES

A deliberate sweep for "which prompts cancel which" across all 568 found:

- **6 explicit cancellations / removals** (above). The user is clear about removals; never silent.
- **No silent supersedes detected** — when the user changes their mind, they say so explicitly. Refinements (e.g. "blur" → "scrim opacity" on image preview; "70%" → "30%" backdrop) are absorbed into the corresponding commits, not added as separate items.
- **Multi-message streams**: the user sometimes sends 3-5 quick prompts that refine a single idea (the 2026-05-21 06:35-06:49 sequence about OpenPortal API independence + offline cache is the canonical example). Treat each contiguous stream as ONE intent; the user's final wording in the stream is authoritative.
- **/ulw-loop and /ralph-loop directives** are NOT new tasks — they're "run your existing queue to completion" commands. Don't add them to the todo.
- **OMO-continuation messages** ("Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.") are NOT user prompts — they're hook-injected automation. Filtered by default in dump-user-messages.

---

## RUN-IT INSTRUCTIONS

To pick up next session:

1. `cd ~/projekty/webapps/portal && git --no-pager log --oneline -15` to confirm tip is `14a0925` (file-mention dual-trigger) or later.
2. `git --no-pager status -s` to see in-flight work.
3. Read this file. Start with PENDING.

**Suggested priority order**:
- #1, #2, #3 (Sections L/M/N) — freshest user dispatches; ALREADY queued via prompt_async `msg_e53093eda` on this session.
- #4 (file-browser scroll cap) — easy, user-visible.
- #13 (context-dial regression check) — easy if regressed; verify first.
- #11 (subagent perm cascade) — verify + fix.
- #5/6 (permalink-UX + server-permalink audit) — moderate.
- #7 (sticky-bottom on banner injections) — moderate.
- #8 (voice premature-flush residual) — investigate.
- #9/10 (recently-mentioned-files implementation + 2-section ordering) — moderate.
- #12 (externalOpencode regression smoke-test) — quick verification.
- #17/18 (LFS/branch-protect operational follow-ups) — quick verification.
- #19 (asset-load smoke-test) — quick verification.
- #20 (compaction-summary GC) — move to opencode-tools backlog.
- Q-items #14, #15, #16 — await user input.

For Section L/M backend (opencode-tools interop):
```
bun ~/projekty/nowaker/opencode-tools/move-local.ts --session <sid> --target <path-or-project-id> [--allow-in-flight] [--dry-run]
```

Library extraction into `_lib/opencode-session-transfer/` is queued separately on the opencode-tools side. For v1, execFile from the openportal backend is the path of least resistance.

---

End of comprehensive AI_TODO.md refresh.
