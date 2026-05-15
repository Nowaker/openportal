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

### Dev sandbox (parallel to prod)

When source changes are big or risky enough that breaking prod
openportal mid-session is unacceptable, deploy to the dev sandbox
first and verify there. Three systemd units make this safe:

- `opencode-sandbox.slice` - 4GB memory cap, isolated from
  `opencode-serve.slice`. Spawned opencodes for the dev sandbox
  live here so a runaway prompt cannot evict the prod opencodes.
- `opencode-sandbox-local.service` - opencode bound to
  `127.0.0.1:4998` with `XDG_DATA_HOME=~/.local/share-sandbox` and
  `XDG_CONFIG_HOME=~/.config-sandbox`. Completely separate DB +
  settings from the user's primary opencode at port 4096.
- `openportal-dev.service` - openportal bound to tailnet IP
  `100.105.229.19:5001` with the env overrides
  `OPENPORTAL_DIR=~/.openportal-dev`,
  `OPENPORTAL_STATE_PATH=~/.openportal-dev-state.json`,
  `OPENPORTAL_DB_PATH=~/.local/share/openportal-dev/openportal.db`.
  Zero risk to prod's registry / auth / db / settings.

Public access via Caddy: `https://dev-portal.desktop.ts.nowaker.net:8443/`
(reverse-proxies to `:5001`). The caddy block lives in
`~/projekty/webapps/caddy/Caddyfile` (user-scope caddy, reload via
`systemctl --user reload caddy.service` - no sudo).

Build cycle for dev:

```bash
cd ~/projekty/webapps/portal
rm -rf apps/web/.output && bun run build
systemctl --user restart openportal-dev.service
curl -sS http://100.105.229.19:5001/ | grep -oE 'src="/assets/index-[^"]*"' | head -1
```

A standalone dev rebuild leaves prod openportal:5000 untouched.

### Turbo cache + asset hash drift

`rm -rf apps/web/.output` alone is sometimes not enough. Turbo's
own cache at `.turbo/`, `apps/web/.turbo/`, `apps/docs/.turbo/`,
`packages/cli/.turbo/`, `packages/openportal-companion-plugin/.turbo/`
can restore a previous build's outputs verbatim when source content
hashes match a prior input - producing the OLD asset hashes when
you EXPECTED new ones. This bit us during the TDZ-fix deploy:
turbo restored a pre-fix bundle.

Force-clean rebuild:

```bash
cd ~/projekty/webapps/portal
rm -rf apps/web/.output \
       apps/web/.turbo apps/docs/.turbo .turbo \
       packages/cli/.turbo packages/openportal-companion-plugin/.turbo
bun run build
# new asset hash will appear in apps/web/.output/public/assets/
```

Then restart prod or dev as usual.

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

### Loading feedback (mandatory)

Any UI that awaits data MUST show a visible loading indicator while
the data is unresolved. The placeholder `—` dash, an empty body, or
an unstyled container does NOT count - the user sees a frozen view
and cannot tell whether the page is fetching or genuinely empty.

Rules:

- Components driven by SWR / useSWR / useSessionMessages: render
  `<Loader className="size-5" />` (or an inline skeleton) while
  `isLoading` is true AND the cached data is empty or insufficient.
- Components driven by ad-hoc fetch + useState: track an explicit
  `loading` boolean and render the spinner branch first.
- Modals MUST cover the body region with a centered loader during
  initial fetch; do not render fields with `?? "—"` placeholders.
- Lists MUST show a spinner row (or skeleton placeholders) until
  the response lands; "No results found" only after the fetch
  resolves with an empty array.
- Bonus: keep the previous data visible during silent refresh
  (`keepPreviousData: true` in SWR) so the spinner only appears on
  cold load, not on every revalidation.

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

## Network trust + presence detection

Two related but distinct signals live on every `/api/instance/self`
response:

- `client` — who is making THIS request right now. Reverse-proxy
  aware, per-request, derived from socket peer + (conditionally
  trusted) `X-Forwarded-For`. Drives the VSCode-link local/remote
  split, the companion plugin's local-vs-remote rendering, and any
  per-call decisions that depend on the immediate caller.
- `presence` — where the user's eyes are right now. NOT per-request;
  it's the last BROWSER-classified request the openportal process
  has seen since startup. Drives the sudo dispatch (GUI askpass on
  this host vs. web modal on the user's remote browser) and
  anything else where the right answer is "where is the human?"
  not "who's calling me?".

Both signals share the same trust model for resolving a real client
IP, but they answer different questions and MUST NOT be conflated.

### Trust model (shared)

| Layer | What it carries | Trust |
|---|---|---|
| TCP socket peer | IP the kernel reports on the inbound connection | always authoritative for "who connected to me" |
| `X-Forwarded-For` first hop | The reverse proxy's claim about the real client | trusted ONLY when the socket peer is one of THIS HOST's own IPs |
| `X-Real-IP` | Same as XFF, single-value | same conditional trust as XFF |

Why conditional: a tailnet peer can fabricate `X-Forwarded-For:
127.0.0.1` on a direct connection. If we trusted that, anyone with
tailscale would mark themselves as "local" and bypass the
GUI-sudo-vs-web-sudo split. We only honor XFF when the socket peer is
already on this host (loopback, or any address from
`networkInterfaces()`, plus the operator-controlled
`OPENPORTAL_LOCAL_IPS` env list).

### Per-request `client` behaviour matrix

| Where the request comes from | Socket peer | XFF trusted? | Effective IP | `client.isLocal` |
|---|---|---|---|---|
| Browser on this host via Caddy | 127.0.0.1 | yes | this host's tailnet IP (from XFF) | true |
| `curl` on this host direct to `:5000` | 127.0.0.1 | yes (loopback) | 127.0.0.1 | true |
| Browser on remote tailnet peer via Caddy | 127.0.0.1 | yes | peer's tailnet IP (from XFF) | false |
| `curl` on remote tailnet peer direct to `:5000` | peer's tailnet IP | no | peer's tailnet IP (socket) | false |
| Remote tailnet peer direct + spoofed XFF: 127.0.0.1 | peer's tailnet IP | NO (the spoof is dropped) | peer's tailnet IP (socket) | false |

### Presence tracker (where are the user's eyes?)

Lives in `apps/web/src/server/lib/presence-tracker.ts`. A Nitro
`request` hook (`apps/web/src/server/plugins/presence-tracker-hook.ts`)
fires on EVERY HTTP request, runs `detectClient(event)`, and — only
if the request's `User-Agent` looks like a real browser — overwrites
a single in-memory record with `{ ip, isLocal, at }`. No history, no
mini-buffer; the last browser request wins, full stop.

Behaviour invariants:

- **Last browser request wins.** No time window, no decay. If you
  send a prompt from m4max your m4max browser's poll lands and the
  process now believes the user is remote. If you then walk to the
  desktop and open openportal there, the desktop browser's first
  request flips presence back to local. There is no expectation that
  a stale 30-minute-old local poll can override a fresh remote one —
  the spec is fresh-always-wins, regardless of magnitude.
- **Browser-only.** `User-Agent` is matched against
  `/Mozilla|Chrome|Safari|Firefox|Edge/i`. curl, wget, Bun/Node
  fetch, and the openportal-sudo-mcp sidecar all fail this filter
  and DO NOT register presence. Critical: the MCP sidecar calls
  `/api/sudo/run` from loopback; if it registered presence it would
  self-flip the verdict to "local" microseconds before the
  dispatcher reads it, defeating the whole point of the tracker.
- **In-memory only.** No disk, no DB. An openportal restart legitimately
  resets presence — the moment the connection-monitor reconnects the
  browser repopulates the tracker. Persisting would re-introduce the
  stale-after-reboot bug the design is avoiding.
- **The sudo dispatcher uses ONLY presence, never per-request `client`.**
  `/api/sudo/run` is called by the MCP sidecar from loopback, so its
  per-request `client.isLocal` is always true and useless for routing.
  `isUserLocallyPresent()` is the correct signal there.
- **VSCode link generation, companion plugin rendering, etc. still use
  per-request `client`.** Those callers ARE the user's browser, and
  "is this request coming from this host" is the right question for them.

The `/api/instance/self` `presence` field exposes the current record
as `{ ip, isLocal, at, ageMs }` so the frontend (and the AI inspecting
its session state) can see where the last browser request came from.
`ageMs` will typically be near zero when the browser itself polls the
endpoint — the request that fetched the response just updated the
record. Look at `ageMs` going up between polls only when SOMETHING
ELSE last hit openportal (a curl probe, an MCP sidecar call) and the
poll is the first browser request after that.

### Caddy / reverse proxy requirements

Caddy v2 already adds `X-Forwarded-For` and `X-Forwarded-Proto`
automatically when you use a `reverse_proxy` directive. The only
non-default thing this trust model needs is:

- **Reverse proxy MUST run on this host** (Caddy, nginx, traefik -
  whichever). Off-host proxies would have a remote socket peer and
  XFF would be ignored. If you absolutely need an off-host proxy,
  add its IP to `OPENPORTAL_LOCAL_IPS` via the systemd unit:

  ```ini
  [Service]
  Environment=OPENPORTAL_LOCAL_IPS=192.0.2.5,2001:db8::1
  ```

- **No XFF stripping**: do not configure Caddy / nginx to strip
  inbound XFF before adding its own (the default Caddy behaviour
  appends, which is what we want). nginx specifically needs
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` if
  ever swapped in.

- **OpenPortal must NOT bind to `0.0.0.0`**: the trust model assumes
  every direct (non-proxied) request is meaningful for presence
  detection. Binding to `0.0.0.0` would mix loopback + tailnet +
  LAN + docker + anything-else on the same listener. Current setup
  binds only to the tailnet IP - keep it that way.

### Verifying after a network change

Per-request `client` (the same IP-trust model the presence tracker
relies on internally):

```bash
# from this host - via Caddy:
curl -sS -k https://portal.desktop.ts.nowaker.net:8443/api/instance/self \
  | jq .client
# expect: { ip: "<this host's tailnet IPv4 or IPv6>", isLocal: true, proxied: true }

# from this host - direct:
curl -sS http://100.105.229.19:5000/api/instance/self | jq .client
# expect: { ip: "127.0.0.1", isLocal: true, proxied: false }

# from a remote tailnet peer (m4max etc) - via Caddy:
ssh m4max.ts.nowaker.net 'curl -sS -k https://portal.desktop.ts.nowaker.net:8443/api/instance/self' \
  | jq .client
# expect: { ip: "<m4max's tailnet IP>", isLocal: false, proxied: true }

# spoof check from a remote peer:
ssh m4max.ts.nowaker.net 'curl -sS -H "X-Forwarded-For: 127.0.0.1" http://100.105.229.19:5000/api/instance/self' \
  | jq .client
# expect: { ip: "<m4max's tailnet IP>", isLocal: false, proxied: false }
# the spoofed XFF MUST be ignored
```

Presence tracker (curl has a non-browser UA, so these calls do NOT
update presence themselves — they let you inspect what the last
genuine browser hit looked like):

```bash
# inspect current presence (whatever the last browser request was):
curl -sS http://100.105.229.19:5000/api/instance/self | jq .presence
# null when no browser has hit openportal since startup;
# otherwise: { ip, isLocal, at, ageMs }

# spoof a browser UA from a remote peer and verify it DOES register
# (this is intentional — the security model relies on tailnet ACL,
# not UA fingerprinting):
ssh m4max.ts.nowaker.net 'curl -sS -A "Mozilla/5.0 Chrome/120 spoof" \
  -k https://portal.desktop.ts.nowaker.net:8443/api/instance/self' \
  | jq .presence
# expect: { ip: "<m4max's tailnet IP>", isLocal: false, ageMs: small }

# back to a non-browser UA — presence should NOT be overwritten:
curl -sS http://100.105.229.19:5000/api/instance/self | jq .presence
# expect: { ip: "<m4max's tailnet IP>", isLocal: false, ageMs: larger }
# the curl call itself was filtered out, so the previous browser
# record is still the "latest browser" record
```

## Settings UI structure

`/settings` is split into seven tabs, hash-routed so deep links like
`/settings#chat` jump directly to the relevant pane. Tab list,
hash array, and TabPanel ids all live in
`apps/web/src/routes/_app/settings.tsx`:

| Tab | Contents |
|---|---|
| `appearance` | Theme, font family, font size, accent (with custom `#hex` + native color picker). |
| `prompt` | Default model, default thinking effort, default agent (per-server / global / default). Voice input. |
| `composer` | Enter-key behaviour, auto-approve permissions (global default + per-session overrides). |
| `chat` | Date/time format (locale / 12h / 24h), link opening behavior, per-icon visibility grid, hover info toggle, info icon toggle, markdown rendering. |
| `tools` | The system + custom tool catalog with enable / edit / reset, project-init ordering. |
| `performance` | Live updates strategy (per-platform), tool output byte cap. |
| `diagnostics` | Health + presence + companion plugin state. |

Heading hierarchy: each `<TabPanel>` has its own `<h2>` for the tab
title and intro paragraph; every sub-section inside a panel uses
`<h3>` with an `<p class="text-xs text-muted-fg">` description.
Mixing `<h2>` for both tab and subsection produces two competing
top-level headings per panel — the `ac069c5` cleanup normalized
everything so this is now a hard rule.

When adding a new sub-section to an existing tab, follow the
existing pattern:

```tsx
<section className="space-y-2">
  <div>
    <h3 className="text-sm font-semibold">Section title</h3>
    <p className="text-xs text-muted-fg">
      One-paragraph description of what this knob does and why.
    </p>
  </div>
  <YourSettingComponent />
</section>
```

When adding a new tab: register the id in BOTH hash-validation
arrays in `SettingsPage()` (initial state + `hashchange` handler),
add a `<Tab id="...">` to `TabList`, and a matching `<TabPanel
id="..." className="pt-6">`. The tab order in the source file IS
the visible order in the tab strip.

## Instance-level settings

Per-openportal-instance configuration that should outlive a
browser localStorage purge lives in `~/.openportal-state.json`
under `settings.<namespace>`. The infrastructure is at
`apps/web/src/server/lib/portal-state.ts` with two read/write
helpers:

```ts
getSettings(): Record<string, unknown>
setSetting(namespace: string, value: unknown): Record<string, unknown>
```

Each feature wraps these into a typed module under
`apps/web/src/server/lib/`:

- `auto-approve-state.ts` — `settings.autoApprove`
  (`globalDefault: boolean`, `sessionOverrides: Record<string, boolean>`).
- `instance-settings-state.ts` — `settings.instance`
  (`toolOutputMaxBytes: number | null`).

Each typed module then exposes:

- A `readConfig(): TypedShape` that validates the loose object
  against the schema (defaults on type mismatch).
- A `writeConfig(config): TypedShape` that round-trips through
  `setSetting()`.
- Public getters/setters that take/return the typed shape.

The HTTP layer is one route per namespace:

- `/api/auto-approve` — GET returns config, PUT updates global default.
- `/api/instance-settings` — GET returns config, PUT updates fields.

Frontend hooks live in `apps/web/src/stores/`:

- `auto-approve-store.ts` — SWR + mutators (uses `globalMutate(KEY, next)` for write-through).
- `instance-settings-store.ts` — same shape.

Settings tab components consume the hook + render an input + on
change call the mutator. Loading-spinner-while-saving is handled
inside the component.

NEVER duplicate the namespace map between server and client — the
server is the source of truth, the client SWR cache is a view.
Putting client-only mirrors into localStorage is the auto-approve
v0 bug we just removed; don't reintroduce it.

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
