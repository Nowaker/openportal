# AGENTS.md - OpenPortal-specific guidance

Operational rules that apply only to the openportal codebase + its
runtime on this user's machine. Cross-cutting personal rules live in
`~/projekty/ai-workspace/AGENTS.md`; this file is the openportal half.

## Operational patterns

### Portal restart cycle (I do this, not the user)

```bash
bash ~/projekty/webapps/portal-runtime/start-or-restart.sh
sleep 8
systemctl --user status openportal.service --no-pager | head -8
curl -sS -o /dev/null -w "%{http_code}\n" http://100.105.229.19:5000/
curl -sS http://100.105.229.19:5000/ | grep -oE 'src="/assets/index-[^"]*"' | head -1
```

systemd owns the registry race - it kills the previous process group
cleanly before exec'ing the new one. The `~/.portal.json` registry
self-heals on each start because runner.sh is the only writer.

### Build -> restart -> commit cycle

1. Edit source under `~/projekty/webapps/portal/`.
2. Always `rm -rf apps/web/.output` before running the web build.
   Vite's incremental rebuild can leave a stale `renderer-template.mjs`
   that bakes the SOURCE `apps/web/index.html` (with `/src/main.tsx`
   references) instead of the post-Vite-transformed HTML with hashed
   asset paths. Symptom: `Failed to load module script: Expected JS
   but server responded with text/html` because `/src/main.tsx` does
   not exist on disk and Nitro's SPA fallback returns the same broken
   HTML.
3. `bun run build` at the monorepo root (turbo dispatches Vite + Nitro
   for web AND a Bun bundle for the CLI).
4. Restart Portal via the systemd cycle above.
5. Verify the new asset hash is in the served HTML AND returns 200.
6. Commit (atomic). Push to BOTH remotes (github + origin gitlab).

### Multiple back-to-back rebuilds

Each rebuild changes asset hashes. The browser may cache the old
`index.html` referencing a hash no longer on disk -> Nitro's SPA
fallback returns HTML -> "MIME type text/html" error. End every
session with a single clean restart so the served HTML matches the
assets on disk. Tell the user to hard-refresh (`Ctrl+Shift+R`) when
in doubt.

### Never restart user-managed opencode

`systemctl --user opencode-serve-tailscale.service` and
`opencode-serve-lan.service` are owned by the user and carry live
in-flight tool calls across every active session. Restarting either
INTERRUPTS every running task. Identify them by hostname (no explicit
`--port`, defaults to 4096) running under their own systemd unit.
Portal-spawned opencodes are different (explicit `--port 4500` etc.)
and may be killed when the lifecycle mode requires it.

## OpenPortal architecture facts

- Hard fork of `hosenur/portal`. Active branch `main-nowaker` against
  remotes `github` (Nowaker/openportal) and `origin` (gitlab
  Nowaker/openportal - canonical).
- Source root: `~/projekty/webapps/portal`.
  - `apps/web/src` - React + tanstack-router + SWR + zustand.
  - `apps/web/src/server` - Nitro v3 API routes (proxies opencode).
  - `packages/cli/src/index.ts` - Bun CLI (~750 lines).
  - `packages/cli/web-wrapper.mjs` - pre-loader for the Nitro bundle
    that suppresses `unhandledRejection` / `uncaughtException` so
    transient opencode outages do not kill the web server.
- Operator launcher: `~/projekty/webapps/portal-runtime/`.
  - `runner.sh` rebuilds the CLI from source before exec (turbo cache
    bit us multiple times by restoring stale dist), waits for
    tailscale, then execs the openportal CLI with `--configless`.
  - Bound to the tailnet IP only (never `0.0.0.0`).
- Config files (all in `$HOME`):
  - `~/.openportal/openportal.json` - server registry, directories,
    history per server, active server id.
  - `~/.openportal/openportal-auth.json` - 0600 SSH/HTTP creds per
    server.
  - `~/.openportal/openportal-vscode-mappings.json` - per-requestor
    VSCode path map.
  - `~/.local/share/openportal/openportal.db` - prompt archive
    (SQLite).

## OpenPortal lifecycle modes (mutually exclusive)

Set in `~/.openportal/openportal.json`. Priority order:
`externalOpencode` > `decoupleOpencode` > legacy.

### `externalOpencode: { port, exitAfterUnreachableSeconds? }`

- openportal NEVER spawns opencode.
- Probes `/config/providers` on the configured port at startup; logs
  warning but starts the web UI even if probe fails.
- Resilience monitor in CLI loops every 5s after startup; tracks
  first-failure timestamp; on reconnect logs duration; on failure
  window > timeout, SIGTERMs web server child and `process.exit(2)`.
- `exitAfterUnreachableSeconds`: 0 = strict, N>0 = tolerate N seconds,
  omitted = default 300.
- `cmdStop` does NOT kill opencode (we do not own it).
- Currently active in this user's setup pointing at port 4096.

### `decoupleOpencode: true`

- openportal spawns opencode on first start, writes pidfile.
- On subsequent starts, attaches to existing opencode if pidfile
  points at a live process whose `/proc/<pid>/cmdline` contains
  `opencode`.
- `cmdStop` does NOT kill attached opencode.

### Legacy (no flag)

- openportal spawns opencode as a child.
- `cmdStop` SIGTERMs both opencode and web server.
- Children orphan when openportal exits without going through `cmdStop`.

### Configless mode (`--configless`)

- CLI flag that bypasses all of the above. openportal never spawns or
  attaches to any opencode; the web UI uses the configured server
  registry directly (multi-server support).
- Active in the systemd unit. Verified via
  `pgrep -af "opencode serve --port"` returning empty.

## UX preferences

### Composer

- Drafts persist in `localStorage["opencode-composer-draft:<sid>"]`,
  debounced 2s.
- Drafts only override existing localStorage if new content >= 10
  bytes (or acknowledged-submit). Prevents accidental clobber from a
  second tab.
- Cross-tab BroadcastChannel `opencode-composer-sync` posts on
  submit; receivers clear their input only if its content is a
  substring of the submitted text.
- Submit policy:
  - `Shift+Enter` always inserts newline.
  - `Ctrl/Cmd+Enter` always submits regardless of viewport.
  - Bare `Enter` submits only on non-mobile when
    `enterKeyAction === "submit"`.
- Pending prompt copy at
  `localStorage["opencode-pending-prompt:<sid>"]` is the safety net
  if dispatch is silently dropped.

### Sidebar

- Project tree honors `level` + `level1` config per base directory.
- Sorting: by last activity at session AND project level;
  alphabetical at any level below.
- Categories with sessions sort alphabetically first; empty
  categories alphabetically after.
- Indicators must cascade through every tree level (leaf project
  rows AND intermediate category rows).
- Last two visual levels of the tree (project header + its session
  rows) MUST share an indicator x-coordinate.
- Search must auto-reveal matches behind any "Show N more" /
  empty-folder / collapsed-ancestor gate.
- Pull-to-refresh disabled by `h-dvh overflow-hidden` shell;
  JS-driven PTR via `usePullToRefresh` is the only path without a
  layout refactor.

### Notifications

- First-load banner asks for permission. States: hidden /
  default-with-Enable / denied-with-unblock-instructions.
- Click on a browser notification uses tanstack
  `navigate({to: "/session/$id"})` - NOT `window.location.href`.
  Full reload destroys SWR cache, drafts, scroll position.

### Connection resilience

- `useConnectionMonitor` pings `/api/instance/self` every 10s with
  5s timeout.
- On disconnect: shows "Reconnecting" banner.
- On reconnect: globally invalidates SWR via `mutate(() => true)`.
- Also fires on focus / visibilitychange / online events.

### Window title

- On session route: `OP: <sessionTitle>` (short prefix, scannable
  in tab strip).
- Off-session: `OpenPortal`.

### Browser target

- Mobile = Android Chrome (iOS auto-zoom acceptable).
- Performance on mobile in mind. 1m intervals for periodic stuff.
  10pct steps for font size.

## Diagnostics protocol

User reports an issue -> my flow:

1. Read user's localStorage / Notification.permission / browser
   console output they paste.
2. Check the actual Portal state via curl + ps + tail of
   `/tmp/portal-*.log`.
3. Identify if it is a stale-bundle issue, a real bug, or a config
   issue.
4. Fix it on my side AND tell the user how to clear the stale state
   on theirs.
5. Restart Portal (always, per the lifecycle rule).

## Codebase environment

- OS: Arch Linux. Bun runtime. Tailscale networking.
- Public access:
  `https://portal.desktop.ts.nowaker.net:8443/` (Caddy reverse-proxy
  -> Portal `:5000` on tailnet).
- HTTP/2 keep-alive caveat: Bun client connection pool can hold
  stale sockets to a restarted backend; the connection-monitor +
  web-wrapper pair handles it.
