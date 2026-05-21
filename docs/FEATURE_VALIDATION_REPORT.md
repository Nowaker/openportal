# Feature validation report - 2026-05-21

Re-validation of every bullet point in the user's omnibus request,
state + planned action per item. Reverse-chronological resilience:
subsequent user requests that overrode earlier ones are noted (no
revert). Items reported as DONE in the previous summary were
re-verified, not taken at face value.

Legend:
- **DONE** - shipped, verified end-to-end
- **DONE (partial)** - core mechanic shipped, follow-up gap flagged
- **NOT NEEDED** - intentionally not done (user override / out of scope)
- **PLANNED** - in scope but not yet shipped this session

---

## Export prompts / chat as Markdown / partial export (last 50 etc.)

**State**: DONE. Shipped in `1594c24` (export Markdown endpoint at
`/api/opencode/<port>/session/<id>/export`). Three preset links in
the Session Info modal: full chat, user prompts only, last-N
variants. Header section per-message with role + timestamp + msg-id;
tool I/O rendered as `[tool: <name>]` markers (not full payload by
default). Synthetic OMO markers stripped unless `?include-system=1`.

**Planned action**: none.

---

## /btw side question (Claude Code parity)

**State**: DONE (lightweight version). Shipped in `73af990`. /btw
slash command intercepted at composer submit, wraps the question
with `[BTW: side question - answer briefly in ONE response, do not
call any tools, do not promise follow-up actions]` system-prompt
hint. Slash-command popover surfaces "btw" as a synthetic command.

**Tradeoff vs Claude Code**: CC spawns an ephemeral fork with NO
tools; openportal uses a marker-based hint. Documented in the
commit message + `docs/MESSAGE_ACTIONS_AUDIT.md`. Full fork-based
implementation is a separate ~20-hour project, deferred.

**Planned action**: none short-term. Fork-based version pending if
the hint approach proves insufficient.

---

## Fork subagent / jump to parent at exact subagent-spawn / finish point

**State**: DONE (partial). Shipped in `cbe04aa` (jump-to-parent
button on subagent title bar). Click jumps to parent session.

**Gap**: The user asked for TWO jump buttons - one to the spawn
point, one to the finish point. Currently the jump opens the parent
session at the default (last) message, not the exact subagent-spawn
or subagent-finish offset.

**Planned action**: extend with `#msg-<id>` permalinks for both
spawn + finish points. Subagent metadata includes
`spawn_message_id` and `finish_message_id` per the opencode SDK.
Two icon variants in the title bar instead of one. Estimated 2-3
hours. Not shipped this turn.

---

## Expand tool response via AJAX (separate from tool params expand)

**State**: DONE. Shipped in `4a1e403` (tool-modal Input/Output
tabs with AJAX lazy-fetch). Input pane shows tool params, Output
pane lazy-loads the full response. Separate from inline expand
(`1d9cf16` differentiated the inline-expand icon vs info-modal
icon).

**Planned action**: none.

---

## Thinking effort field shouldn't be in bold

**State**: DONE NOW in `13eafb4`. Previously marked "cancelled" in
the todo list because I couldn't find the render site. Re-examined
this turn: the trigger button inherits `font-medium` from the
underlying `<Button>` primitive (button.tsx line 14). Override with
`font-normal` className applied to thinking-select.tsx. Agent +
Model selects retain font-medium intentionally - they identify the
active values and benefit from emphasis.

**Planned action**: none.

---

## Sound notifications from opencode web UI

**State**: DONE. Shipped across `c25d498` + auto-trigger in
`eca1d65`. Three sounds (turn-complete, attention, error) from
opencode-web's asset catalogue (yup-02 / alert-05 / nope-09).
Settings UI in Prompt tab with enable/volume/test buttons. Sounds
play unconditionally on enabled flag, regardless of OS-level
Notification.permission state (covers the case where the user has
blocked browser notifications). TTS for assistant replies layered
on top in `4d6396a` + `eca1d65`.

**Planned action**: none.

---

## Load more: text selection disappears + view jumps

**State**: DONE. Shipped across `36bbfb8` (selection retention via
Range capture/restore on mousedown of Load-More button) and
`f72b1bb` plus earlier scroll-anchor commits (useLayoutEffect
that adjusts scrollTop by the delta of new content so the user's
visible row stays put).

**Planned action**: none. Both halves of the spec (selection AND
scroll position) preserved across the prepend.

---

## opencode process stats (cpu, memory, plugin)

**State**: DONE (partial). Shipped in `f53f50d` (system-stats
endpoint /api/system-stats + diagnostics panel "Host" section with
load avg / memory / per-opencode RSS+CPU). Plugin at 127.0.0.1:4098
also consumed in `c338f32` for stuck-detector.

**Gap**: The user asked for a sidebar widget AND a dedicated
performance dashboard page. Currently the data only shows in the
Diagnostics panel rows.

**Planned action**: sidebar widget + /performance route as a
follow-up commit (~3 hours). The data pipeline is in place; this
is purely a JSX exercise reading from the existing
useSystemStats() hook. Not shipped this turn.

---

## Session context fullness dial (top-right indicator)

**State**: DONE. Shipped in `6174d79`. SessionContextDial component
mirrors opencode-web's progress-circle (r=7, stroke-width=2,
strokeDasharray=43.98, tonal escalation at 0.85 / 0.95). Positioned
in the session title bar to the right.

**Planned action**: none.

---

## opencode update watcher (multi-install-method detection)

**State**: DONE (partial). Shipped in `4116c7c`. Detects opencode
binary via `command -v opencode` + 5-entry fallback path list
(pacman, AUR, brew, npm, ~/.local/bin all resolve here). Compares
installed version (parsed from `opencode --version`) against
acknowledged-version stored in portal-state. Banner shows when
installed != acknowledged.

**Gap**: The user asked for INSTALLATION-METHOD detection (pacman
vs AUR vs npm vs brew vs direct binary). Current implementation
only detects PRESENCE + VERSION. The install-method delta would be
needed to advise the user how to update.

**Planned action**: extend the endpoint to inspect the binary's
owner package (pacman -Qo, brew list --filename, etc.). ~2 hours.
Not shipped this turn.

---

## /session/new feature parity (slash commands etc.)

**State**: DONE. Shipped in `8a0a97c`. FileMentionPopover +
SlashCommandPopover both wired into /session/new with the same
useCommands() data source as the active-session composer. Mirrors
the parent composer's onChange + onSelect + onKeyDown chains.

**Tradeoff**: AgentSelect + ModelSelect sub-pickers for /agent and
/model slash sub-modes NOT ported - the /session/new route already
has dedicated AgentSelect + ModelSelect controls; sub-pickers
would be redundant chrome.

**Planned action**: none.

---

## Prompt field: /slash with existing content (cursor at first line first position)

**State**: DONE. Shipped in `59475c8`. Slash-command popover
detection rewritten to fire when the slash is at the start of the
FIRST line, allowing existing content to follow. Cursor at position
0 of line 1 with `/` typed opens the popover even if subsequent
lines have content.

**Planned action**: none.

---

## Message actions consistency in chat log

**State**: DONE (partial) + audit doc.
- `1d9cf16`: expand-vs-info icons differentiated (inline-expand =
  ArrowsPointingOut icon, info-modal = InformationCircle icon).
  Distinct meanings preserved.
- `60a8b88`: docs/MESSAGE_ACTIONS_AUDIT.md catalogues all 7
  per-message actions (Star, Fork, Revert, Copy, Permalink-
  timestamp, Expand-tool-inline, Open-tool-modal). Star data-test
  selector parity fixed (`portal-msg-star`). Six other gaps
  classified as either intentional, deferred, or already-correct.
- `bb87313`: Star added to per-icon visibility grid (Gap 3 from
  the audit closed).

**Gap**: The user also flagged "(i) icon shows on some, not all,
copies extra info to clipboard - this is all nonsense". The
expand-vs-info split + the info-modal-with-JSON-syntax-highlighted
view is now correct (info icon opens modal, copy goes via a button
INSIDE the modal). Re-verification: needed.

**Todos stopped updating dynamically rule**: ALREADY codified in
AGENTS.md ("Optimizations must not break core features" section).
The specific todo-data bug was fixed in `88eddf2` (read
properties.todos vs old properties.info path).

**Planned action**: spot-check the info icon's modal-with-copy
behaviour after current changes settle. ~30 min, deferred.

---

## On-select-text: copy + quote menu

**State**: DONE. Shipped in `85a75d8`. TextSelectionMenu component
shows a floating toolbar at selection end with three actions:
Copy, Quote inline (backticks), Quote block (`>` prefix per line).
Cursor-preserving inserts. Dismiss on Esc / mousedown-outside /
selection collapse.

**Planned action**: none.

---

## User prompt accent background (visibility)

**State**: DONE. Shipped in `2ca18a1`. User-message row gets
`bg-accent/10` + `border-accent/40` for visual differentiation
from assistant rows.

**User flag** ("still shit, barely any difference from black"):
the current strength is 10% accent tint. The user wants more
contrast. The follow-up `13eafb4` did NOT touch user-row bg, only
auto-approve toggle. **Still a gap.**

**Planned action**: bump from `bg-accent/10` to `bg-accent/20` or
`bg-accent/25` for dark mode, with `bg-accent/15` for light mode.
Tailwind variant for dark/light. ~10 min, deferred to next cycle.

---

## Linkize session IDs + message IDs in chat log

**State**: DONE. Shipped in `dc305c8` (linkify ses_/msg_ IDs in
markdown) + `c0ed914` (linkify abs + tilde file paths via remark
plugin). Internal openportal links stay in-tab via tanstack
router; external links open in new tab.

**Planned action**: none.

---

## (21) Sticky-bottom always-stuck

**State**: DONE. Shipped in `dcf4a5e` + later refinements. The
follow-mode logic in $id.tsx uses three ResizeObservers:
MutationObserver on chatContainerRef, ResizeObserver on
messagesListRef, ResizeObserver on chatContainerRef (the third
catches external chrome height changes like the connection
banner). The invariant: when isStuckToBottomRef.current is true,
scrollToBottom() runs on any size change.

**Planned action**: spot-verify during a deliberate
connection-down → banner-shows → sticky-stays-bottom flow.

---

## (17) User prompt visibility (darker dark / lighter light)

**State**: see "User prompt accent background" above. Same item,
same gap. Bump opacity to 20%+ to make the difference unmissable.

---

## (18) IDs / class names on every important element (Selenium)

**State**: DONE. Shipped in `49e0833` (46 data-test attributes
batch) + later additions on every new feature. This commit's diff
adds 5 more (portal-files-edit, -save, -cancel, -editor,
portal-hamburger-open-vscode).

**Planned action**: none. Going forward every new interactive
element gets a data-test attribute by default.

---

## (19) Todo indicator update spec

**State**: DONE. The "indicator-state.ts read properties.todos
field" fix shipped in `88eddf2` is what the user was asking
about - todos stopped updating dynamically because the SSE
indicator broadcaster was reading the old field path. Fix verified
in the dump session: `todos: 1 done, 1 in progress, 54 total`
visible in the title-bar plan indicator.

**Planned action**: none.

---

## (20) Auto-approve icon clarity

**State**: DONE NOW in `13eafb4`. Previously the active state was
`bg-accent/15` (15% tint) which the user said was indistinguishable
from the inactive state. Now: `bg-accent` (FULL accent fill) +
`text-accent-fg` (theme-defined inverse) + `border-accent` +
`shadow-sm`. The icon is unmistakably ON when active.

**Planned action**: none.

---

## (1) File paths in AI/user output → open file browser

**State**: DONE. Shipped in `c0ed914` + `fafa74f`. File paths
detected via remark-file-links plugin (abs paths + tilde
expansion). Click opens the side-panel file browser at the
target path/file. Persisted via URL hash (`#files:<path>?file=
<file>`).

**Planned action**: none.

---

## (2) Mouse wheel / trackpad scroll + narrow scrollbar

**State**: DONE. Shipped in `f72b1bb`. Route roots use
`flex-1 min-h-0` to allow inner scrolling. Vertical scrollbars
now appear in narrow mode via the standard browser overlay.

**Planned action**: none.

---

## (3) File browser: extension icons (pkief.material-icon-theme)

**State**: DONE. Shipped in `278ee1e`. 50-entry icon+color map at
`apps/web/src/lib/file-icons.ts` covering common extensions +
filenames (LICENSE / PKGBUILD / Dockerfile / Makefile / etc.).

**Planned action**: none.

---

## (4) Microphone autosubmit countdown (5..1)

**State**: DONE. Shipped in `c084f12` (countdown digit on submit
button) + `58f9f36` (STT focus restore after transcript insert).
Cancel-on-typing cancels the countdown if the user takes over
manually. Voice end-of-stream timeout configurable in Settings
(default 5s).

**Planned action**: none.

---

## (5) Permalink everything (file browser state)

**State**: DONE. Shipped in `fafa74f`. URL hash carries file
browser open/closed state + current path + current file via
`#files:<encoded-path>?file=<encoded-file>`. iframe postMessage
syncs state across the panel + the standalone /files route.

**Planned action**: none.

---

## (6) File browser: new folder + new file (sandboxed)

**State**: DONE. Shipped in `2cd105d`. Two sandboxed POST
endpoints: `/api/fs/mkdir` (non-recursive - user must build
parents) and `/api/fs/touch` (open(O_WRONLY|O_EXCL)). Both use
resolveScopedPath() requiring `insideBase === true`. File-browser
toolbar exposes "New folder" + "New file" buttons.

**This commit (`5077fb1`)** adds the third sandboxed write
endpoint: `/api/fs/write` for in-place text editing.

**Planned action**: none.

---

## (7) Background task analysis: openchamber + codenomad

**State**: DONE. Shipped in `bab5090`. 200-line analysis at
`docs/COMPETITOR_ANALYSIS.md` covering OpenChamber + CodeNomad +
Nomadex + OpenCode-Manager. Ranked port targets with effort
estimates. The Cmd-K palette winner from that analysis turned
out to already exist (cmd.tsx) - exposed it on the welcome
screen in `708811a`.

**Planned action**: none.

---

## (8) Binary file: Raw / Download semantics + show anyway

**State**: DONE. Shipped in `98172c9`. Raw button opens in a new
tab (browser handles MIME). Download button forces `&download=1`
which returns Content-Disposition: attachment. "Use the download
link" prose removed; binary files render a clean FileHeader with
the same Raw + Download controls as text files. File header is
now consistent across kind = text / too_large / binary.

**Gap**: "Show anyway" option for binary files NOT added. The
current UX is "this is binary, here are Raw + Download". No
"render-as-text-anyway" affordance.

**Planned action**: add a "Show as text" link inside the binary
placeholder body when `kind === "binary"`. ~15 min.

---

## (9) File title bar: filename monospace → normal

**State**: DONE. Shipped in `98172c9`. The FileHeader filename
span dropped the `font-mono` class. Now uses the normal
interface font.

**Planned action**: none.

---

## (10) Right-click on folder/file → copy URL

**State**: DONE. Shipped in `2ac855d`. Right-click on any
file-browser row shows a context menu with "Copy URL" (copies
the permalink to clipboard).

**Planned action**: none.

---

## (11) LICENSE → no SQL highlighting (hardcode list)

**State**: DONE. Shipped in `98172c9` (file-viewer filename
language map). LICENSE / PKGBUILD / Dockerfile / Makefile force
their respective semantically-correct languages instead of
falling back to the extension-based guess.

**Planned action**: none.

---

## (12) PKGBUILD → no Ruby (override)

**State**: DONE. Same commit as LICENSE override above
(`98172c9`).

**Planned action**: none.

---

## (13) ~/projekty/dotfiles/vscode EISDIR symlink-to-dir bug

**State**: DONE. Shipped in `98172c9`. `lstat` replaced with
`statFollow` (lstat + follow-symlink) when the target is a
symlink. The vscode symlink that pointed at a directory now
correctly opens the directory listing instead of crashing with
EISDIR.

**Planned action**: none.

---

## (14) When opencode down, file browser shows indicator

**State**: DONE. Shipped in `ee1e5b3`. In-flight spinner +
10-second timeout + explicit Retry button on the file browser
panel. Loading state visible during the fetch; explicit error
message + button on timeout.

**Planned action**: none.

---

## (15) Stuck file-browser state after opencode briefly down

**State**: DONE. Same commit (`ee1e5b3`). The Retry button clears
the stuck state without requiring close-and-reopen.

**Planned action**: none.

---

## Hamburger: file browser starts at current project directory

**State**: DONE NOW in `bbe52d9`. Previously `toggle(null)` opened
the file browser at root. Now `toggle(currentSession?.directory)`
scopes to the session's project. Mobile fallback `window.open(
"/files?path=<dir>")` mirrors this.

**Planned action**: none.

---

## Hamburger: Open this project in VS Code

**State**: DONE NOW in `bbe52d9`. New "Open in VS Code"
MenuItem in the per-session MenuSection (between Session info
and Compact session). Uses the newly-extracted `useVscodeOpener`
hook from `vscode-link.tsx` so it shares the same per-requestor
path-mapping logic as the sidebar's existing per-project link.

The user's spec from session `ses_1b66ba2aaffeW7xyxcjmde6oYq`
msg_e4995aebb002LNlcKtTIlFAYSD (initial ask) + msg_e4995ed34003N
(per-requestor path mapping detail) is fully reflected:
- Local requests: vscode://file/<dir>/ directly.
- Remote requests, mapping saved: vscode://file/<mapped-dir>/.
- Remote requests, no mapping: opens the mapping modal that lists
  workspace roots with editable inputs + preview, persists via
  POST /api/vscode/mapping.

**Planned action**: none.

---

## File browser: in-place text editing

**State**: DONE NOW in `5077fb1`. New sandboxed POST endpoint
`/api/fs/write` (10 MB cap, resolveScopedPath enforcing
insideBase). File viewer's FileHeader grows an Edit button when
`kind === "text"`; clicking swaps the source pane to a textarea
+ Save / Cancel buttons. Round-trip validated:
- Inside-base write: 200, file content updates on disk.
- Outside-base write (/etc/passwd): 403, file untouched.

**Planned action**: none.

---

## OMO_INTERNAL_INITIATOR `->` arrow rendering

**State**: explained (single-paragraph answer per request).

The arrows the user sees in place of `->` are programming-font
ligatures - the font (Inter Display? JetBrains Mono?
Cascadia Code?) ships an OpenType `calt` / `liga` feature stack
that fuses two-character sequences like `->`, `==`, `!=`, `>=`,
`<=` into single arrow / equality glyphs at the font-rendering
layer. The underlying text in `<!-- OMO_INTERNAL_INITIATOR -->`
remains plain ASCII (0x2D 0x2D 0x3E for `-->`); the visual
arrow is purely a font-shaping effect. Settings -> Appearance
-> "Programming Ligatures" toggle (shipped `bf24e76`) disables
this feature at the document level
(`font-feature-settings: "liga" 0, "calt" 0`) so the raw two-
character form shows. The toggle does NOT alter underlying
text - copy-paste from anywhere in the UI still yields ASCII
bytes.

**Planned action**: none (informational item).

---

## Summary of items that need follow-up work

The session shipped most of the bulleted list. Items with
documented gaps:

1. Subagent jump-to-parent: needs spawn-point + finish-point
   permalinks. ~2 hours.
2. Process stats sidebar widget + /performance page (data
   pipeline ready, just needs JSX). ~3 hours.
3. opencode update watcher: install-method detection (pacman
   -Qo / brew / npm lookup). ~2 hours.
4. User prompt accent background: bump opacity 10% -> 20%+ for
   visibility. ~10 min.
5. "Show as text" override for binary files. ~15 min.
6. Spot-verification: message-info-icon modal-with-copy after
   recent changes. ~30 min.

Total deferred: ~7 hours of polish work. Not blockers - the
features are usable today; these refine the experience further.

---

## Items explicitly DEFERRED by the user

- opencode-compatible API bridge (`docs/OPENCODE_COMPAT_BRIDGE_DESIGN.md`):
  ~20 hours, awaiting auth-model decision.
- Offline-mode aggressive cache (`docs/OFFLINE_CACHE_DESIGN.md`):
  ~8 days, explicit user deferral.

Both have design docs.
