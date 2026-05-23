# OpenPortal

A mobile-first, multi-server web UI for [opencode](https://opencode.ai),
running over Tailscale. Configless by default - it never spawns or
manages an opencode process, only talks to ones you already run.

**Canonical source:** https://gitlab.com/Nowaker/openportal

The GitHub mirror at `Nowaker/openportal` is a push target only -
issues, discussions, and pull requests are disabled there. File
anything that needs a tracker on GitLab.

## Principles

- **Configless first.** OpenPortal never starts opencode for you. It
  discovers running instances on your tailnet/LAN and lets you bind
  the UI to one. If the instance dies, OpenPortal stays up; if
  OpenPortal restarts, your opencode sessions keep streaming. The
  two lifecycles are intentionally independent.
- **Multi-server is the unit of work.** A "server" is a configured
  opencode instance. Each carries its own directories, history, and
  credentials. Switching servers swaps the entire workspace without
  restarting anything.
- **Mobile-first, desktop-comfortable.** Sessions, file browsing,
  diffs, voice input, and notifications all work from a phone over
  Tailscale. The same UI scales up to laptop layouts without losing
  density.
- **Hide the orchestrator noise.** OMO/Ralph/ULW directives and
  system reminders that other agents inject into prompts get
  collapsed into one-line wrappers with a clickable expand. Wire
  payload is stripped server-side - the body is fetched on demand
  when you actually expand a block.
- **Tailscale is the only public surface.** Bind to the tailnet IP,
  reverse-proxy through Caddy under `*.desktop.ts.nowaker.net`,
  never `0.0.0.0`. Permissions and credentials sit behind
  Tailscale's authn.
- **No silent failures.** Question forms, permission widgets, and
  stuck-busy indicators carry explicit recovery paths. Native
  opencode answers go through the dedicated `question.reply` /
  `permission.reply` APIs; locally-tracked dismissal sets shield the
  UI from eventual-consistency races against opencode.
- **Atomic commits, dual remotes.** Every change ships to both
  GitLab (canonical) and GitHub (mirror). History is kept linear
  on `main-nowaker` so the diff is always easy to read.

## Features

### Session browsing

- Multi-server registry: configured + auto-discovered, per-server
  directories with simple list / advanced JSON / history-snapshot
  modes.
- Sidebar tree honours per-directory `level` + `level1` grouping;
  active-session indicator cascades through every level.
- Subsession glyph (purple) distinguishes parented sessions from
  top-level ones in the Cmd palette.
- Ctrl+K palette: word-boundary scorer with title-weighted matches,
  match-character highlighting, multi-word query support.
- Pin sessions to topbar; drag-reorder; mobile-safe long-press.

### Chat surface

- Streaming chat with sticky-bottom semantics; jump-to-bottom button
  surfaces the moment the user scrolls up.
- OMO directive collapsing: `<ultrawork-mode>`,
  `<auto-slash-command>`, `<command-instruction>`,
  `<system-reminder>`, `[search-mode]`, `[analyze-mode]`, MANDATORY
  params blocks, OMO_INITIATOR-terminated blocks. Adjacent triggers
  consolidate into one wrapper that exposes every contributing
  trigger header.
- Server-side OMO body strip with lazy-fetch endpoint - cuts wire
  size 10-100x for OMO-heavy sessions.
- Fork from any message via opencode's `/session/{id}/fork`; revert
  also available, both inline next to each message.
- Prose blockquotes strip the `@tailwindcss/typography` italic and
  curly-quote glyphs - chat reads like chat, not a publication.
- Code blocks word-wrap with `break-all` to avoid horizontal scroll
  on phones.

### Composer

- Mode + Agent + Model + Thinking-effort pickers (compact, content-
  sized, no greedy expansion).
- Slash commands route through opencode's `session.command` (phases
  1-3); `/agent <name>` and `/model <name>` inline overrides
  (phases 4-5).
- Drafts persist per-session with cross-tab BroadcastChannel
  reconciliation.
- Voice STT (push-to-talk + VAD modes), STT v1 model bring-your-own
  download.
- Attachments: paste, drag, file picker; images, PDFs, text files.

### File browser

- Right-side panel (desktop) with drag-resize handle; close button
  lives in the iframe's own toolbar (no separate title bar).
- Standalone `/files` route for full-window browsing.
- shiki + flourite syntax highlighting across ~200 languages with
  manual-override picker.
- Markdown / HTML viewer with sandboxed iframe preview and
  sync-scroll.
- Bare-tilde paths (`~/foo`) instead of `~user/foo`.

### Prompt history

- SQLite archive with substring search (LIKE COLLATE NOCASE) -
  catches `bleh` inside `dupableh`.
- Auto-expand current project + session when entered via the topbar
  burger; collapse-all when entered via the sidebar footer.
- One-click refire into the current session.

### Question + permission UX

- Native `question.reply` routing; bypasses opencode's stale-filter
  to map (callID -> requestID) even after chat moves on.
- Permission widget: Allow once / Allow always / Reject with
  local-dismiss tracking so a freshly-replied request cannot get
  resurrected by an eventually-consistent polling response.
- Audit trail: every reply (manual or auto) leaves an inline pill
  next to the originating tool call with the decision and an
  `auto` badge when the worker fired it. 7-day in-memory TTL.
- Auto-approve: backend-persisted in
  `~/.openportal-state.json settings.autoApprove` (global default
  + per-session overrides) and fired by a server-side worker that
  holds a `/event` SSE connection to every configured opencode -
  approvals continue with no browser tab open. Composer shield
  toggle writes the same store; toggling to a value matching the
  global default removes the override so Settings only lists
  genuinely-different sessions.
- Confidence indicators per request type.

### Operator surface

- `/servers` page: add manually, scan via mDNS / Tailscale peers,
  promote discovered to configured, set per-server credentials.
- VSCode link generation with per-requestor path-mapping (local vs
  remote IP) at `~/.openportal/openportal-vscode-mappings.json`.
- Pin-bar drag-reorder (desktop) + read-only display (mobile).
- Connection monitor: pings every 10s, surfaces "Reconnecting"
  banner, globally invalidates SWR cache on reconnect.
- Permalinks: any URL carries `?server=<id>` for the currently-
  bound server. Open in another tab / paste in chat / scan a QR
  and the receiving openportal binds to the matching server (or
  falls through to the picker if the id is unknown). Emitted by
  the layout effect, consumed by `POST /api/servers/active`.

### Plugin telemetry (companion plugin)

- `packages/openportal-companion-plugin` is an opencode-side plugin
  that observes events, tool calls, permission asks, and
  compactions, then writes a rolling snapshot to
  `~/.openportal/companion-plugin-state-<port>.json` (per-port so
  two opencodes don't race on a single file).
- One-click install from the Plugin Info modal: writes the plugin
  entry into `~/.opencode/opencode.json`. "Install & Restart"
  picks up the systemd unit name from `/proc/<pid>/cgroup` and
  restarts that unit; system-scope units prompt for sudo via an
  in-browser modal (password is piped through stdin, never argv,
  never logged).
- Detect-other-instances enumerates every running opencode-serve,
  maps each to its systemd unit + scope, and renders them in the
  panel so you can tell which one is currently bound.

### System messages drawer

- Always-accessible dropdown anchored to the bottom-left of the
  layout (bell icon + unread-count badge). Acts as the durable
  audit log for OpenPortal-side events that today fire toasts and
  forget: connection lost / restored, service restart attempted /
  success / error, plugin install events, notification permission
  changes, and other portal-side notifications. Chat content does
  NOT route here — chat lives in the session route, the drawer is
  for system events.
- In-memory ring buffer holds the last 200 events per browser tab;
  reload clears it (localStorage persistence is a v2 follow-up).
- Each entry carries a category badge, timestamp, level icon
  (info / warning / error / success), short message, and an
  expandable details block for full error text / stack traces.
- Important messages MUST route through the drawer in addition to
  any short-lived toast - the toast is the ephemeral notification,
  the drawer is the durable record. `logSystemMessage(category,
  level, message, details?)` from `apps/web/src/stores/system-
  messages-store.ts` is the contract; use it alongside the
  matching `toast.*` call.

### Plumbing

- Bun runtime; Nitro v3 server; tanstack-router + SWR + zustand on
  the client.
- Single `--configless` flag in CLI; systemd `Restart=always` with
  MemoryHigh/MemoryMax caps to survive runaway-prompt OOMs.
- Per-message OMO cache with 24h TTL; messages-list LRU cache with
  2s freshness window.
- Image-data-URL stash to `~/.cache/openportal/blobs/<sessionId>/`
  + thumb generation - keeps wire payload small even with
  multimodal attachments.

## Configuration

Configuration lives in `~/.openportal/openportal.json`. Servers,
directories, active server id are tracked here; the CLI writes,
the UI reads.

Credentials (per-server SSH / HTTP) live in
`~/.openportal/openportal-auth.json` (mode 0600). VSCode path
mappings in `~/.openportal/openportal-vscode-mappings.json`.

Prompt archive: `~/.local/share/openportal/openportal.db`.

## Running

OpenPortal is not packaged for general consumption. The active
deployment runs as `systemctl --user openportal.service` against
the source tree at `~/projekty/webapps/portal` and is bound to a
Tailscale IP behind a Caddy wildcard cert. See `AGENTS.md` for the
operational rules I rely on day to day.

## Tech stack

- [React](https://react.dev) + [TanStack Router](https://tanstack.com/router)
  + [SWR](https://swr.vercel.app) + [zustand](https://zustand-demo.pmnd.rs)
- [Nitro](https://nitro.build) server, [Bun](https://bun.com) runtime
- [Tailwind](https://tailwindcss.com) + the typography plugin (with
  blockquote overrides)
- [shiki](https://shiki.style) + [flourite](https://github.com/teknologi-umum/flourite)
  for code highlighting
- [opencode SDK](https://www.npmjs.com/package/@opencode-ai/sdk) for the
  upstream API client

## License

MIT.

## Attribution

OpenPortal is a hard fork of [hosenur/portal](https://github.com/hosenur/portal)
by Hosenur Rahaman. The fork diverged early - it is now an independent
project with its own scope (multi-server, configless, mobile-first,
Tailscale-bound). No upstream PRs are sent back. Issues, ideas, and
contributions go to the canonical GitLab repo above, not the upstream
or the GitHub mirror.
