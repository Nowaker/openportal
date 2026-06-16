# AGENTS.md - OpenPortal-specific guidance

Operational rules that apply only to the openportal codebase + its
runtime on this user's machine. Cross-cutting personal rules live in
`~/projekty/ai-workspace/AGENTS.md`; this file is the openportal half.

## Project-specific rule overrides

These statements OVERRIDE the global personal rules in
`~/.config/opencode/AGENTS.md` for this repository only:

- **Push freely. The global "Never push without explicit instruction"
  rule does NOT apply to openportal.** Push to both `origin` (gitlab)
  and `github` after each commit, same way you commit freely without
  asking. The user maintains openportal solo + iterates fast; waiting
  for push permission adds friction without protecting anything.
  Force-push only on feature branches as the global rule still says,
  never on `main-nowaker` or other protected branches.

## Analysis / deep-explanation requests

When the user asks for an analysis, a deep explanation, or a survey
of how something works (anywhere in this repo or its sibling
projects), follow this protocol:

1. **Persist the analysis to `ai-analysis-requests/<TOPIC>.md`** in
   this repo. One file per inquiry. Filenames are `SCREAMING_SNAKE_CASE`
   topic names — `SLASH_COMMANDS.md`, `FEATURE_VALIDATION_REPORT.md`,
   `MESSAGE_ACTIONS_AUDIT.md`, etc. The doc captures the FULL
   investigation: file paths, line numbers, code excerpts, design
   tradeoffs, open questions.

2. **Add a todo item with `status: "done"` and
   `description: "User Review"`.** The todo tracks that the user
   still needs to read + approve the doc. Never delete completed
   todos of this kind unless the user explicitly tells you to —
   they form a session-spanning audit trail.

3. **In the final assistant message, give a SHORT summary** (one
   paragraph or a few bullets) of the analysis's conclusion, plus a
   project-relative markdown link to the full doc. The link MUST be
   relative to the current opencode workspace root (which may not be
   this repo - e.g. when the session originates from
   `~/projekty/ai-workspace`, the link from there should be
   `webapps/portal/ai-analysis-requests/SLASH_COMMANDS.md`). When in
   doubt, build the link by resolving from the opencode session's
   `directory` field.

4. **Older analyses get the same treatment**. If the user references
   an earlier inquiry in the same session, the persisted doc IS the
   reference - update it in place rather than re-writing the
   explanation inline. Treat the directory as the canonical record.

## AI_TODO.md is the canonical task queue (binding)

`AI_TODO.md` at the repo root is the durable cross-session task
queue for this project. The user's personal
`~/.config/opencode/AGENTS.md` defines the schema; this section is
the project-specific enforcement contract.

**Every user prompt that maps to a queueable task MUST land in
`AI_TODO.md` in the same turn it's accepted.** Skipping the sync
because "I'll batch later" is a contract violation. Compaction
wipes the in-memory todo list; `AI_TODO.md` is the only thing that
survives.

Required format per entry (matches the existing #1-#72 entries):

```
### N. <Short title> (<status: PENDING | DONE - <commit> | Q-DEFERRED>)

User prompt (verbatim):

> <copy-paste the user's exact words, no paraphrase, no trimming>

Design notes:
- <what the task means>
- <implementation approach>
- <deferred follow-ups, file paths, dependencies>
```

Operational rules:

- **Append-only by number.** Pick the next integer after the highest
  existing entry (currently #72). Never re-use numbers. Never edit
  shipped entries except to flip `PENDING` to `DONE - <commit>` or
  add a follow-up commit reference.
- **Batch sync for the same turn.** When a single user prompt
  enqueues multiple items, each item gets its own numbered entry.
  When you fall behind (multiple prompts arrived without a sync),
  catch up in the next AI_TODO sync commit and reference the
  prompts that triggered them.
- **Status discipline.** New work starts `(PENDING - <reason>)`.
  In-flight work flips to `(IN PROGRESS - <reason>)` only if the
  user is watching a long task; otherwise jump straight to
  `(DONE - <commit>)` on landing. `Q-DEFERRED` for open user
  questions whose decision is awaited.
- **Dedicated AI_TODO commit.** When the only change is the
  AI_TODO entry (no code), the commit subject MUST start with
  `AI_TODO.md:` so the user can scan history for queue mutations.
  Code commits that ship the work and update AI_TODO at the same
  time fold both into one atomic commit; mention the AI_TODO
  update in the body.
- **Position keywords.** Honour the user's queue-position words:
  `enqueue at end` (default), `enqueue as next` (right after the
  in-progress item), `next`, `before X`, `after X`, `now`,
  `immediately`. The numbered order in the file reflects
  chronological order of acceptance; the actual work order is
  whatever the in-memory todo list says. Re-ordering across
  entries is fine; renumbering is not.

- **Safe diffs (binding when AI_TODO has concurrent writers).**
  Multiple agents writing to `AI_TODO.md` from sibling worktrees /
  sessions is the norm here. To keep the file mergeable:
  - **Append-only**: never touch existing numbered entries except
    to flip `PENDING` → `DONE - <commit>` in place. No edits to
    historical entries, no reformatting, no reordering.
  - **Anchor every diff at the END of the file**, after the most
    recent numbered entry but before the trailing meta sections
    (Q-DEFERRED, ARCHITECTURE REFERENCE, etc.). Parallel agents
    appending the same way land on neighbouring lines and git's
    three-way merge resolves cleanly.
  - **No renumbering, ever.** Pick the next unused integer at
    insert time. If a race produced a duplicate number, the loser
    bumps to N+1 in the next sync turn, never by rewriting
    history.
  - **One numbered entry per commit** for AI_TODO-only changes -
    the smaller the patch, the less surface for conflict. Code
    commits that already update AI_TODO inline are allowed to
    ship 1-3 entries together.

- **Temp-file fallback when AI_TODO.md is unmergeable.** If
  `AI_TODO.md` shows up in `git ls-files --unmerged`, or another
  agent's mid-flight edit is visible (raw `<<<<<<<` markers,
  partial reformatting, etc.), do NOT add your entry directly -
  editing now will mangle their merge. Instead:
  1. Write the intended entry into
     `AI_TODO_<yyyymmdd>_<hhmmss>_<short_title>_<ses_id>.md` at
     the repo root, using the same numbered-entry format as a
     real entry. Example filename:
     `AI_TODO_20260527_2030_settings_polish_ses_b7c2fa.md`.
  2. These temp files are `.gitignore`d under the
     `AI_TODO_*_ses_*.md` pattern, so they sit safely in the
     working tree without polluting commits.
  3. Re-check `AI_TODO.md` periodically. As soon as it returns to
     a clean mergeable state, append the entry from your temp
     file to the END of `AI_TODO.md` (still respecting the
     safe-diff rules above), then delete the temp file - either
     in the same commit that ships your work, or in a dedicated
     post-merge `AI_TODO.md: sync ...` commit.
  4. If a session ends with the temp file still on disk, the
     next session reading the repo root MUST scoop it up before
     starting new work. The filename's timestamp + session id
     makes ownership unambiguous.

If the user reminds you to sync (as in 2026-05-26
msg_e6580ef5b...), you're already late. Stop, sync, then resume.

## Operational patterns

### Where openportal runs from (per branch)

| Branch / worktree | Where it runs | How to (re)start |
|---|---|---|
| `main-nowaker` (`~/projekty/webapps/portal`) | systemd unit `openportal.service` on port 5000 | `bash scripts/deploy.sh` (full cycle) or `bash ~/projekty/webapps/portal-runtime/start-or-restart.sh` (registry-aware restart). NEVER use `scripts/run-worktree.sh` on the main repo. |
| Any other worktree (`~/projekty/webapps/portal-<feature>`) | foreground process from `bash scripts/run-worktree.sh` on port 5200 (default) or arg | `bash scripts/run-worktree.sh [PORT]`. Ctrl+C to stop. NEVER touch systemd from a worktree. |

**AI-session caveat (binding):** `run-worktree.sh` ends in `exec env -i ... bun ...` — it is a BLOCKING foreground process. An AI agent that calls `bash scripts/run-worktree.sh` inline in a Bash tool call will hang until its timeout, then leave the bun process orphaned. From an AI session, ALWAYS background + log to a file, e.g.:

```bash
cd ~/projekty/webapps/portal-<feature>
nohup bash scripts/run-worktree.sh > /tmp/portal-worktree-<feature>.log 2>&1 &
disown
sleep 6   # give the build + bind time
curl -sS -o /dev/null -w "%{http_code}\n" http://100.105.229.19:5200/
tail -n 60 /tmp/portal-worktree-<feature>.log
```

Then to stop: `pkill -f "wt-<INSTANCE_TAG>"` (the `--name wt-...` arg is the unique marker) or `kill <pid>` from the disown'd job. NEVER use this on the main repo at `~/projekty/webapps/portal` (see prod row above).

**Fresh worktree dependencies:** git worktree shares `.git` only — `node_modules/` is per-working-directory, so a brand-new worktree has none. BEFORE the first `run-worktree.sh` (or any direct build), run `bun install --frozen-lockfile` from the worktree root. Symptom of skipping it: `scripts/build.sh` fails immediately because `turbo` / nitro deps are unresolvable. `bun install` in a worktree is fast (5-20s) because the global bun cache is shared.

The worktree script lives in-tree (`scripts/run-worktree.sh`) so every
worktree has it without sibling-runtime-dir setup. It:

- Builds `apps/web/.output/` + `packages/cli/dist/` from the worktree's
  source (turbo-cache-skipping `bun build`).
- Binds to the tailnet IP, same as prod.
- Forces full isolation: `~/.openportal-worktrees/<branch>/openportal.json`
  + `~/.openportal-worktrees/<branch>/openportal-state.json` +
  `~/.local/share/openportal-worktrees/<branch>/openportal.db`. Prod's
  `~/.openportal/*` is untouched.
- Seeds the registry to point at the user's prod opencode on
  `127.0.0.1:4096` so the worktree UI sees real opencode state. Edit
  the seeded `openportal.json` to retarget.
- Default port `5200` (prod is 5000, dev is 5001, openchamber is on
  5100). Override with `bash scripts/run-worktree.sh 5123`. Re-running
  `REBUILD=1 bash scripts/run-worktree.sh` forces a fresh bundle.
- On first launch the script materializes `packages/cli/web ->
  apps/web/.output` (worktree-local symlink) so the CLI's
  `existsSync(WEB_SERVER_PATH)` startup gate passes. The symlink is
  per-worktree and not committed.

### Worktree integration cycle (rebase, then FF merge)

When a worktree feature branch is ready to land on `main-nowaker`,
ALWAYS rebase the feature branch onto current `origin/main-nowaker`
before merging. Cherry-pick is NOT a substitute: it produces a new
SHA on `main-nowaker` and orphans the feature branch's commit, so
the feature branch and its eventual merge SHA no longer share
identity. `main-nowaker` moves fast (multiple commits/hour during
active days from parallel worktree sessions), so by the time a
worktree is ready the feature branch is almost always stale.

Canonical sequence, run from the worktree:

```bash
# 1. Pick up upstream tip
git fetch origin main-nowaker

# 2. Rebase feature branch onto current main
git rebase origin/main-nowaker
# Resolve any conflicts here, in the worktree where the dev server
# is running and you can smoke-test the resolution before merging.

# 3. Force-push the rebased feature branch (lease-protected)
git push --force-with-lease origin <feature-branch>
git push --force-with-lease github <feature-branch>

# 4. Switch to the main repo, FF the now-current feature branch into main
cd ~/projekty/webapps/portal
[ "$(git symbolic-ref --short HEAD)" = "main-nowaker" ] && \
  git fetch origin main-nowaker && \
  git pull --ff-only && \
  git merge --ff-only <feature-branch>

# 5. Deploy + push main
bash scripts/deploy.sh
git push origin main-nowaker
git push github main-nowaker
```

Why FF-only on step 4: `--ff-only` rejects the merge if the feature
branch isn't a descendant of `main-nowaker`, which is exactly the
condition the rebase in step 2 guarantees. If FF fails at step 4,
something raced (another commit landed on main between step 2 and
step 4) - re-run from step 1.

Conflicts during rebase: resolve them ONLY in the worktree, never
in the main repo. The worktree has the running dev server, isolated
state, and the same shell history that built the change - you can
re-test the rebased version end-to-end before committing.
Aborting (`git rebase --abort`) is the right move if conflicts touch
code you don't understand; ask before plowing through.

NEVER cherry-pick to work around a non-FF state on main-nowaker.
The orphaned feature-branch SHA is recoverable via reflog but the
linear history invariant is not - main ends up with a different
commit message author/date than the feature branch the user
reviewed, and the dual-remote push pattern loses its meaning.

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

### Type-checking before commit (mandatory for .ts / .tsx changes)

Vite uses esbuild for transpile-only — it NEVER type-checks. `bash
scripts/build.sh` and `bash scripts/deploy.sh` both produce green
output even when the source has undefined identifiers, wrong arity
calls, or other TS errors. Those bugs surface only at runtime in
the browser, often as `ReferenceError: <name> is not defined`. This
is exactly how commit `12ac206` shipped a broken model picker — a
refactor dropped imports but left a dead-code call site, and the
build / deploy didn't notice.

MANDATORY: after every commit-worthy edit that touches a `.ts` or
`.tsx` file under `apps/web/src/`, run from the repo root:

```bash
cd apps/web && bunx tsc --noEmit 2>&1
```

ALWAYS run the FULL check, not a file-narrowed grep. The codebase has
~30 pre-existing tsc errors in unrelated files (`app-sidebar-nav.tsx`,
`app-sidebar.tsx`, `cmd.tsx`, `companion-telemetry-panel.tsx`, etc.);
driving them all to zero is out of scope. The contract is "your
changes introduced NO new errors mentioning files you edited" — not
"zero errors overall". Read the full output, identify any error
mentioning a file in your diff, fix those before commit. Pre-existing
errors in untouched files are ignored.

NEVER reduce scope to "just my files" by piping through `grep` — the
full output is what the human runs in their terminal, and it's how
mismatches between "I think my changes are clean" and reality surface.
A narrowed grep can miss a knock-on TS2304 in a file you forgot you
edited.

If any error in the full output mentions a file you touched, you
broke something. Fix or revert BEFORE running `scripts/deploy.sh` —
never deploy code whose tsc errors are your own.

LSP-only `lsp_diagnostics` checks are NOT sufficient on their own.
The LSP runs against a per-file editor view; cross-file refactor
holes can pass LSP (because the IDE tsserver session caches the
old symbol table) yet fail `tsc --noEmit` from a fresh process.
Always run `bunx tsc --noEmit` from `apps/web/` for the final
gate, not just the LSP.

### Build -> restart -> commit cycle

The canonical full cycle is one command: `bash scripts/deploy.sh`.
It wraps `scripts/build.sh` plus the dev-first sequence:

1. Build the bundle via `scripts/build.sh` (see below for what it
   guarantees on its own).
2. Seed the render-check fixture session into the dev OpenPortal
   SQLite cache.
3. Restart `openportal-dev.service` (port 5001, isolated DB/config).
4. Probe `http://100.105.229.19:5001/` until it serves the new
   asset hash (max 15s).
5. Run the headless browser render check against the dev session
   route. This loads the seeded session page in Chromium and fails on
   console errors, runtime exceptions, 5xx XHR/fetches, missing
   fixture messages, or missing fixture tool rows.
6. ONLY if dev came up green, seed the same fixture into the prod
   OpenPortal cache.
7. Restart `openportal.service` (port 5000) and probe
   `http://100.105.229.19:5000/` for the same hash.
8. Run the same browser render check against prod.
9. Exit non-zero (and leave prod untouched where possible) if any
   probe or render check fails.

This catches asset-pipeline regressions on the side channel before
they bounce the user's prod chat sessions. The dev portal has
`TimeoutStopSec=2` so the side-channel hop only costs ~5s; prod
keeps its 30s for clean SSE drain. Override knobs:
`DEPLOY_SKIP_DEV=1` (NOT RECOMMENDED) bypasses the dev probe;
`DEPLOY_SKIP_SESSION_RENDER_CHECK=1` (NOT RECOMMENDED) bypasses
the Chromium session-route render gate; `DEPLOY_DEV_URL` /
`DEPLOY_PROD_URL` retarget the probes.

Then: 6. Verify in the browser. 7. Commit (atomic). 8. Push to
BOTH remotes (`origin` gitlab + `github`).

`scripts/build.sh` itself (called by `deploy.sh`, but also fine to
invoke directly when only building):

- Snapshots current `.output/public/assets/` to a /tmp dir BEFORE
  the wipe.
- Wipes `.output` AND every `.turbo/` cache in the monorepo
  (turbo's content-hash cache otherwise hands back a stale bundle
  when source matches a prior input).
- Builds.
- Re-layers the snapshot assets back into the fresh
  `.output/public/assets/` so prior builds' hashes coexist with the
  new ones. The asset-fallback middleware (below) serves anything
  on disk, so a browser tab still referencing an older hash gets
  its file - it does NOT crash on MIME mismatch.
- Prunes retained assets older than 14 days.

NEVER call `bun run build` directly outside the wrapper - it wipes
old assets without retention and breaks any browser tab that hasn't
yet refetched the new `index.html`. Outside of an explicit one-off
"just build, don't deploy" need, `scripts/deploy.sh` is the canonical
path.

NEVER restart `openportal.service` standalone for code changes -
that defeats the dev-first guarantee. Use `scripts/deploy.sh`.

`scripts/deploy.sh` does the restart for you. After it prints
`===== deploy ok =====` the new bundle is serving on
`https://portal.desktop.ts.nowaker.net:8443/`. You do NOT need to
manually `systemctl --user restart openportal.service` afterwards -
that's already happened. The user (whose browser tab may still be
showing the old bundle from before the deploy) typically needs a
hard refresh (Ctrl+Shift+R / Cmd+Shift+R) to pick up the new
asset hash. The asset-fallback layer keeps the old tab working
without crashes; the user just has to reload to see the new code.

### Stale asset 500s are impossible by construction

A browser tab whose cached `index.html` references a hashed asset
that has been rebuilt away would, in a naive setup, request the
deleted file, miss the manifest, fall through to Nitro's SPA fallback
(returns `index.html` as HTML) and crash the `<script type="module">`
loader with "Failed to load module script: text/html". This codebase
defends against that on three independent layers:

1. `scripts/build.sh` preserves prior builds' assets on disk for 14
   days. The hash a browser references is almost always still there.
2. `apps/web/src/middleware/asset-fallback.ts` (registered via
   `handlers: [{ route: "/assets/**", ... }]` in nitro.config.ts)
   serves ANY file present under `.output/public/assets/` with
   `Content-Type: application/javascript` and an immutable cache
   header. Resolution uses `globalThis.__nitro_main__` (same as
   Nitro's own asset path resolution), NOT `process.cwd()` (which
   under `systemctl --user openportal.service` resolves to
   `/home/nowaker/projekty` and would miss the .output dir entirely).
   The middleware also adds `X-OpenPortal-Asset-Source: disk|shim`
   so the browser DevTools network panel makes the path visible.
3. If a hash is truly gone (older than retention), the same
   middleware returns a 200 reload shim: 460 bytes of JS that
   `location.reload()`s, guarded by sessionStorage against
   infinite reload loops. The reloaded `index.html` (route rule
   `Cache-Control: no-store` on `/`) references the current
   hashes; the page recovers without manual intervention. The
   `error.ts` handler has the same shim as a fourth fallback in
   case Nitro routes the request through an error path instead.

To verify the layers are intact after a rebuild:

```bash
curl -sS -D - -o /dev/null http://100.105.229.19:5000/assets/index-FAKEHASH.js | grep -i x-openportal-asset-source
# expect: X-OpenPortal-Asset-Source: shim
```

Net effect: the user-reported `net::ERR_ABORTED 500` for
`/assets/index-OLDHASH.js` is structurally impossible.

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
`~/projekty/dotfiles/dotfiles/caddy/Caddyfile` (user-scope caddy, reload
via `systemctl --user reload caddy.service` - no sudo). The
`~/projekty/webapps/caddy/Caddyfile` path is a leftover from the
single-port era; the running unit reads the dotfiles copy (verify with
`ps -ef | grep caddy` - the `--config` argument is authoritative).

Build cycle for dev (or prod - both share the same `.output`):

```bash
cd ~/projekty/webapps/portal
bash scripts/build.sh
systemctl --user restart openportal-dev.service
curl -sS http://100.105.229.19:5001/ | grep -oE 'src="/assets/index-[^"]*"' | head -1
```

A standalone dev rebuild leaves prod openportal:5000 untouched at the
process level - the restart only re-execs the dev service. Both share
the same `.output` directory on disk, so a build + dev restart means
prod is also serving the latest bundle the next time it restarts.

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

### Native HTML widgets (mandatory)

NEVER use the browser's built-in alert/confirm/prompt dialogs,
native `<select>` dropdowns, native file pickers, or any other
default-browser-chrome control inside the application. ALWAYS reach
for the project's visual framework component first.

Hard rules:

- No `window.alert`, `window.confirm`, `window.prompt`. The drawer
  modal pattern (react-aria `<Modal>` / `<Dialog>`) is the canonical
  replacement; toast notifications cover the alert case.
- No bare `<select>` / `<option>`. Use `<Select>` +
  `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>` from
  `apps/web/src/components/ui/select.tsx`. For searchable lists,
  use the Autocomplete + SearchField variant (model-select.tsx is
  the canonical example).
- No bare `<input type="file">`. Use the project's drag-drop
  attachment surface and/or the explicit "Attach file" buttons that
  trigger a hidden, controlled input.
- For path text fields, use `<PathInput>` from
  `apps/web/src/components/ui/path-input.tsx` so Tab-completion,
  Enter-submit, and the project's styling all come for free.
- For confirmations with destructive action, the existing
  ConfirmDialog / Modal patterns are the right surface, with explicit
  Cancel / Confirm buttons - no `window.confirm` shortcut even when it
  would compile.

Why: native widgets render with the browser's OS theme (light/dark
mismatch, weird mobile pickers, no font/spacing harmony with the
rest of the app), do not respect the project's accent color or
text-selection rules, and produce inconsistent UX across desktop /
mobile / TalkBack. The blocking dialogs (`alert` / `confirm` /
`prompt`) additionally freeze the whole page synchronously and read
as dated 90s-era browser chrome, out of place in a modern app. The
visual-framework components address every one of those gaps.

This rule applies retroactively. If a reviewer finds a native
widget on a form surface, they can swap it for the visual-framework
equivalent without further discussion.

### Form-field fonts (mandatory)

Prompt fields and other free-form text fields are NEVER monospace.
Code-like fields (file paths, URLs, hostnames, ports, IPs, JSON
blobs, shell commands, command-line arguments, identifier strings)
SHOULD be monospace.

Hard rules:

- NEVER apply `font-mono` (Tailwind) or `font-family: monospace`
  (raw CSS) to a textarea that holds prose - prompts, descriptions,
  chat composer input, search queries, names, titles, message
  bodies, free-form notes.
- DO apply monospace to fields that hold code-shaped content -
  see audit list in this section's commit history for the
  canonical legitimate set (host / port / path / URL / JSON / argv
  / level-1 list / MCP type).
- The base `<Input>` and `<Textarea>` components do NOT apply
  monospace by default. Monospace is opt-in at the call site, which
  is the right shape - each field declares its own semantics.
- The `<PathInput>` component DOES default to monospace because
  every consumer of it is a path field. That's correct.

Why: monospace on a prose field reads as "this looks like code I'm
not supposed to mistype". Users hesitate, slow down, or paste
mismatched whitespace. Proportional fonts on prose remove the
friction and signal "type whatever you want".

This rule applies retroactively. Reviewers may strip `font-mono`
from any prompt textarea without further discussion. Cross-ref:
the monospace audit shipped alongside this rule classified every
existing `font-mono` form-field hit as legitimate (kept) or wrong
(stripped) - see the commit's accompanying report.

### Text selection (mandatory)

Any text rendered in the UI MUST be selectable by the user. Period.
The user copy-pastes log lines, session IDs, error messages, tool
output, sidebar paths, and chat content all day long; an
accidentally-disabled `user-select` breaks a workflow that should
just work.

Hard rules:

- NEVER add `select-none` (Tailwind) or `user-select: none` (raw CSS)
  to ANY element that contains text content.
- If you find an existing `select-none` on a text element, REMOVE
  it unless its presence is justified by a comment naming a real
  use case (drag handles, image-like decorations, badges that exist
  purely as visual icons).
- The "looks like a button so it shouldn't be selectable" rationale
  is WRONG. Buttons are selectable in every native UI on the
  planet, and so are ours.
- A "looks like an icon" rationale is fine ONLY when the element is
  truly a glyph with no text body (e.g. a `<svg>`). Heroicons
  rendered as `<svg>` are already non-selectable by default; you
  don't need to enforce it.
- `select-none` IS appropriate on drag handles, sortable grip
  affordances, and ambient overlay layers that catch pointer
  events but aren't supposed to receive text focus. Anywhere else,
  it is a bug.

If you're tempted to disable selection to "prevent accidental
selection while dragging" or "prevent text drag on a button" -
reach for `draggable={false}` or `WebkitUserDrag: 'none'`, not
`user-select: none`. Those preserve text selection while killing
the drag misbehaviour you actually wanted to fix.

This rule is permanent. Reviewers may revert any `select-none`
addition without further discussion.

### List stability under inline toggles (mandatory)

Toggling an inline control on a list row - a checkbox, switch,
enable/disable, star, pin flag, any per-row boolean - MUST NOT change
that row's position in the list. The user is frequently mid-interaction,
clicking several controls on the same row in a row; if the row jumps to a
new slot after the first click, the next click lands on the wrong row (or
on empty space). It is one of the most infuriating UX failures in the app.

Hard rules:

- A row's display position MUST derive from a key that is STABLE under
  the toggle: a declaration index, an insertion order, an explicit
  user-chosen order, or an alphabetical key on a field the toggle does
  not change. NEVER derive display order from the very state the
  checkbox mutates (e.g. "checked rows first", "enabled rows on top",
  "init templates grouped above the rest").
- If you want grouping/sorting by a toggled flag, compute it ONCE
  (on mount / on data load) and freeze it in component state; reseed
  only when the set of rows changes (add/remove), never on a flag flip.
  A re-sort on reload is acceptable; a re-sort on click is not.
- Reordering a row is allowed ONLY in response to an explicit reorder
  gesture - a drag, an explicit "move up/down" control, or the user
  changing an explicit sort selector. Never as a side effect of toggling
  an unrelated per-row flag.
- This applies to every list surface: settings template flags, sidebar
  entries, pinned items, server lists, permission rows, file rows, and
  any future list with per-row toggles.

Why: see the template Settings flag list, where "Init-first" sorting made
a row leap to the top of the section the instant you ticked Init, so
ticking "Default on" right after missed. The fix froze the display order
in local state and only lets drag reorder it.

Reviewers may revert any change that reintroduces toggle-driven reordering
without further discussion.

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

The rule applies AT ROUTE-LOAD TIME too. A route MUST render its
own data shell within one paint after navigation - the user must
see the route header, layout, and a loading indicator on the data
region immediately. NEVER block the route render waiting for an
opencode-dependent enrichment field (session titles, model name,
provider id, owner instance). Render the base data from openportal
state (SQLite archives, instance settings, sidebar tree) IMMEDIATELY
and let per-cell `<Loader />` spinners fill in opencode-sourced
fields as their fetches resolve. A 15-30s blank-screen wait while
SWR pulls in 12k session metadata records is a CONTRACT VIOLATION,
not "the page is loading" - it means the route blocks itself on a
field it could render lazily.

Heavy outgoing-route unmounts (e.g. navigating away from a session
with 12k MessageItem components) block React's commit phase and
freeze the new route's first paint behind the old route's
teardown. Wrap user-initiated navigation calls in
`startTransition(() => navigate({...}))` so React can yield to the
browser during the unmount and the new route's loading shell
appears within the next paint instead of after the full
synchronous teardown.

### Async-action feedback (mandatory)

Distinct from the read-side rule above. Any user-initiated action
that awaits a server round-trip (Submit, Save, Send, anything
that runs against opencode) MUST surface progress immediately and
stay informative across multi-step flows. A frozen UI between
"clicked Submit" and "page navigated" is unacceptable - the user
has no idea whether the click registered, whether openportal is
working on it, or whether opencode is the slow one.

Rules:

- The click MUST take effect within one paint. Disable the
  triggering control, swap its label/affordance to a spinner-state
  ("Sending..."), or hide the input area entirely if the next
  state replaces it.
- If the flow has multiple phases (e.g. createSession then POST
  /prompt then navigate), the visible status text MUST update at
  each phase so the user can tell which step is slow. Generic
  "loading..." is not enough.
- For new-session submit specifically: clear the template picker /
  init UI on click, render a prominent loader + status text in
  its place ("Asking OpenCode to create a new session..." ->
  "Session created. Sending your prompt to OpenCode..." ->
  "Prompt accepted. Opening the session..."), and show the user a
  preview of what they actually submitted so they can confirm the
  prompt landed correctly.
- Error path: clear the loading state, restore the form, surface
  the error inline. The user must be able to retry without
  reloading the page.

For multi-step flows that create new entities visible elsewhere in
the UI (new sessions in the sidebar, new pinned items, new prompts
in archive), open a virtual / placeholder entry the moment the
flow starts so the user sees activity on the relevant surface. The
placeholder carries a transient id; when the real id lands, swap.
Sidebar entries for placeholders must visually mark themselves as
"creating" (spinner + faded text) and forbid the items that
require a real session id (Rename, Pin, Open in VSCode, Permalink,
Fork, etc.) until promotion.

### Everything is a permalink (URL-driven UI state)

Every non-trivial UI surface MUST round-trip through the URL: paste
the URL into a fresh browser tab, get back exactly the same view. No
exceptions for "it's just a modal" or "it's just a panel". The user
should never be unable to share or bookmark a state they're currently
looking at.

Any UI element whose action navigates to a route, hash, or external
destination MUST render as a real browser-recognized link (`<a>`,
TanStack `<Link>`, React Aria `Link`, or `MenuItem href`). It may be
styled like a button, tab, row, chip, icon, or menu item, but the DOM
must expose an href so right-click, Shift/Ctrl/Cmd-click, copy-link,
and open-in-new-tab work normally. Do NOT implement navigation with a
plain `<button>` / `<div>` plus `navigate()` / `window.location` just
because it looks visually button-like. Buttons are for actions that
mutate, toggle, submit, open non-URL-backed transient UI, or otherwise
do not have a destination URL.

Covered:

- Active session: `/session/<id>` route path. Already routed.
- Active server: `?server=<id>` search param. Already routed (the
  layout effect emits, `POST /api/servers/active` consumes).
- Settings tabs: `/settings#<tab-id>` hash. Hash-routed in
  `apps/web/src/routes/_app/settings.tsx` via `setSettingsTab`.
- Message permalinks: `/session/<id>#msg-<msg-id>` hash, with the
  smart-window loader (`use-session-messages.ts`) reading the
  fragment on cold load.
- Session info modal: `/session/<id>#info` via the canonical
  `useHashOpen("info")` hook in
  `apps/web/src/hooks/use-hash-open.ts`. Back/forward navigate in
  and out of the modal.

Required for any new modal, panel, expanded section, or wizard:

- Boolean open/closed state: use `useHashOpen(hashId)` from
  `apps/web/src/hooks/use-hash-open.ts`.
- String-valued state (selected MCP, selected plugin, file path
  in a browser, etc.): the URL must encode the value too. Follow
  the same hash pattern: `#mcp:redis`, `#plugin:foo`,
  `#files:/abs/path`. URL-encode the value with
  `encodeURIComponent`. A `useHashValue<T>(prefix)` follow-up
  hook is fair game when more than one consumer needs it.

The acceptance test for any new UI state: open it, copy the URL,
hard-refresh, expect the exact same view. If the test fails, the
state is wrong and must be moved into the URL.

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

### Composer layout (mobile-safe — DO NOT regress)

The chat composer in `apps/web/src/routes/_app/session/$id.tsx` and
the new-session composer in `apps/web/src/routes/_app/session/new.tsx`
share a layout contract that exists ONLY because of mobile failure
modes. Every part of the contract has a real bug behind it; do not
revert any of these without re-reproducing the bug.

- **60% visualViewport cap on the composer wrapper.** Both composers
  use `useComposerMaxHeight()` from
  `apps/web/src/hooks/use-composer-max-height.ts` to compute
  `Math.round(visualViewport.height * 0.6)` with visualViewport
  resize/scroll listeners. The composer's outer wrapper carries
  `style={{ maxHeight: ${composerMaxHeight}px }}` + `overflow-hidden`.
  Why visualViewport and not `dvh`: on Android Chrome / iOS Safari
  `dvh` lags or stays at the full viewport while the soft keyboard
  is up, leaving the composer overlapping the keyboard.
  `visualViewport.height` is the browser-blessed source of truth for
  "how much of the page can the user actually see right now".

- **Full `flex-1 min-h-0` cascade from composer wrapper down to the
  textarea wrapper.** The maxHeight cap is only effective if every
  intermediate container propagates the bounded height. In
  `session/new.tsx` specifically: the inner padding container
  (`pt-0.5 ...`) AND the form AND the textarea wrapper
  ALL need `flex-1 min-h-0 flex flex-col`. Skipping any one of them
  lets the textarea grow with content past the cap, push the wrapper
  past the cap, and (because of `shrink-0` on the composer in the
  page's outer flex column) push the templates / chat content above
  the composer off-screen. The session/$id.tsx layout already had
  the cascade; new.tsx needed `flex-1 min-h-0` added to two
  intermediate containers.

- **Submit button + STT mic + abort stop button float absolutely at
  the bottom-right of a relative textarea wrapper.** Layout:
  ```tsx
  <div className="relative min-w-0 flex-1 min-h-0 flex flex-col overflow-hidden">
    <Textarea ... className="... rounded-none border-x-0 border-b-0 focus:border-x focus:border-b focus:ring-0 pl-[5px] pt-[3px] pb-[3px] pr-[46px]" />
    <div className="pointer-events-none absolute bottom-1 right-1 flex flex-col items-end gap-1.5">
      {/* mic + stop in a pointer-events-auto row when active */}
      <Button type="submit" className="pointer-events-auto size-12 !p-0 ..." />
    </div>
  </div>
  ```
  Why not the old flex-row + `items-stretch` + `shrink-0` button
  column: the combination of `field-sizing: content` on the
  textarea + `items-stretch` on the row + `shrink-0` on the button
  column let some Android Chrome layout paths push the textarea
  past the composer's `maxHeight` cap, and the wrapper's
  `overflow-hidden` clipped the BOTTOM of the row — which is where
  the submit button lived. With absolute positioning, the buttons
  are anchored to the relative wrapper (which IS properly bounded
  by the flex-1 cascade), so they stay at the bottom-right of the
  visible composer area regardless of textarea content height.
  - Textarea padding: `pl-[5px] pt-[3px] pb-[3px] pr-[46px]`.
    The 46px right inset reserves space for the 44px-wide submit
    column anchored at `bottom-1 right-1` (4px from edge) so text
    never slides under the floating button. The 5px / 3px insets
    on the other three sides are intentionally minimal.
  - Textarea borders: `rounded-none border-x-0 border-b-0`. The
    base `border border-input rounded-lg` is overridden so only
    the top hairline remains in the rest state. On focus the
    other three sides return as 1px hairlines via
    `focus:border-x focus:border-b`; the default focus ring is
    suppressed (`focus:ring-0`) so the focused look is just
    "all four sides at 1px", nothing more.
  - The overlay wrapper is `pointer-events-none` so clicks in the
    "empty" area pass through to the textarea (focus, selection).
    Each button is `pointer-events-auto` so clicks register on the
    button itself.

- **`touch-pan-y` + `overscroll-contain` on the Textarea component.**
  Set in the base class list at
  `apps/web/src/components/ui/textarea.tsx`. Without them, Android
  Chrome bubbles finger-drag inside the textarea up to the nearest
  scrollable ancestor (the chat container, the new-session page),
  and the user sees the wrong surface scroll. `touch-pan-y` locks
  the gesture to vertical inside the textarea; `overscroll-contain`
  prevents fall-through to the page once the textarea hits its
  scroll limit.

- **NEVER restore the old `flex items-stretch gap-2` row layout.**
  The flex row felt cleaner in code but had three coupled failure
  modes on mobile (textarea unbounded growth, submit button clip,
  touch-scroll bubbling) plus the new-session covering the
  templates. The floating-button refactor (commit landing this
  rule) closes all four. Reviewers reverting any part of this
  layout MUST first reproduce the mobile bugs on a real phone or a
  Chrome DevTools mobile-emulation viewport.

- **Textarea `min-h` floor MUST accommodate the floating button
  column.** The column height is `mic-row h-6 (24px) + gap-1.5
  (6px) + submit size-12 (48px) = 78px`. Add the `bottom-1.5`
  offset (6px) where the column anchors, plus a matching 6px top
  inset for symmetric breathing room, and the textarea wrapper
  needs to be at least 90px tall before the column starts
  poking out of the top. Current floor is `min-h-[max(6rem,100%)]`
  (96px) on `session/$id.tsx`, `min-h-[120px]` on `session/new.tsx`
  — both above the 90px threshold. If you ever shrink either,
  empty composer + STT-enabled mic button = mic clipped by the
  textarea's top border ("poked in half"). The 4.5rem (72px) the
  refactor inherited from the pre-floating-button era was below
  the threshold and shipped the bug; #94 / `<commit>` raised it
  to 6rem.

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

`/settings` is split into eight tabs, hash-routed so deep links like
`/settings#chat` jump directly to the relevant pane. Tab list,
hash array, and TabPanel ids all live in
`apps/web/src/routes/_app/settings.tsx`:

| Tab | Contents |
|---|---|
| `appearance` | Theme, font family, font size, accent (with custom `#hex` + native color picker). |
| `prompt` | Default model, default thinking effort, default agent (per-server / global / default). Voice input. |
| `composer` | Enter-key behaviour, auto-approve permissions (global default + per-session overrides). |
| `chat` | Date/time format (locale / 12h / 24h), link opening behavior, per-icon visibility grid, hover info toggle, info icon toggle, markdown rendering. |
| `templates` | System + custom + filesystem template catalog with three per-row flags (On / Init / Slash). Drag-handle on the LEFT of each row reorders Init-marked rows in the durable `projectInitOrder`. Init pre-checks the row in the new-session picker and concatenates body on submit (archived as `/template Name` lines). Slash registers the row as a `/template <name>` autocomplete entry in both composers. Three sections in order: System templates (stock - Pull / Push / Create PR), Your templates - global (custom from local store, Edit + Delete, no [Custom] badge), Your templates - filesystem (per-workspace `.vibekick/templates/*.md` files with the same three flags driven by YAML frontmatter; "+ New filesystem template" form has workspace-root `<Select>` + sub-path `<PathInput>` with `/api/fs/list` completion). Stock tools have Edit + Disable (no Delete); custom tools have Edit + Delete. Filesystem rows render the workspace path as a header above each group. "+ Add custom tool" footer is sticky. |
| `content` | Content visibility — what types of content show in the chat log and how (tool output byte cap; Section I will expand this into a per-content-type visibility table). |
| `performance` | Live updates strategy (per-platform) and other UI responsiveness knobs. |
| `diagnostics` | Health + presence + companion plugin state. |

Heading hierarchy: tab panels do NOT render their own tab-name
heading - the active tab in the sticky tab strip already shows the
section name, so an `<h2>Appearance</h2>` at the top of the
appearance panel just duplicates it. Sub-sections inside a panel use
`<h3 class="text-sm font-semibold">` with a `<p class="text-xs
text-muted-fg">` description. A short `<p class="text-xs
text-muted-fg">` intro paragraph at the top of a panel is fine for
tabs where the tab name alone is ambiguous (Composer, Files, Content,
Notifications, Performance currently keep one); skip it when the tab
name plus the sub-section headings carry their own meaning
(Appearance, Prompt, Chat, Tools, Diagnostics).

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

## Optimizations must not break core features

Wire-size and bandwidth optimizations are routine in this codebase
(OMO body strip, image data-URL stashing, diagnostics field drop,
heavy-input-field replacement, output truncation, etc.). They are
welcome - and they have ONE hard constraint:

> **No optimization may degrade or break a feature the user is
> already using. If a transfer-reduction patch turns a live-updating
> control into something the user has to click to load, that patch
> is a regression. Roll it back or design around it. Never ship
> "optimized but worse".**

Concrete trip-wires:

- Live indicators (todo strip counts, in-progress tool name,
  compaction badge, queued badge, attention dots) must stay
  push-driven via the SSE indicator stream. Stripping the source
  fields from `/messages` to save bytes is fine; relying on a
  separate lazy AJAX fetch to repopulate them on each render is
  not.
- Inline content (markdown text, tool input/details, todo bodies
  shown in the strip overlay) must render with no extra round-trip
  after the chat list is loaded. Expand-to-fetch is acceptable
  for genuinely heavy bodies (full tool stdout, huge file reads)
  and must be marked explicitly as expand-on-click in the UI.
- Cross-tab sync (BroadcastChannel composer, indicator state)
  must keep working even when one tab paid the optimization tax.
  Don't gate cross-tab payloads on cache state that may be empty
  on the receiver.
- Sticky-bottom semantics, scroll position preservation, selection
  retention - none of these may regress when the underlying data
  is fetched in a smaller/lazier shape.

When in doubt: ship the feature first, then look for the win. If
both can land, both land. If only the optimization can land, it
doesn't land.

## Caching proxy + authoritative-only invariants (binding)

OpenPortal is **the source of truth** for everything the user has
ever observed. Quote, verbatim from the user:

> openportal must be a caching proxy for opencode. If you see msgid
> 1 in sesid 1, you cache it! You know it's there. Only when you
> hear from opencode AUTHORITATIVELY (not a fucking timeout or
> empty array due to a bug or something) that it's not there,
> should you update your cache and no longer display.

> REMEMBER OPENPORTAL IS THE SOURCE OF TRUTH.

This is a hard architectural invariant for everything the UI
reads from opencode. Hard rules:

- **SQLite persistence for everything cacheable.** `messages_cache`
  + `sessions_cache` (migration 0004 in
  `apps/web/src/server/lib/migrations/0004_message_session_cache.sql`)
  back the in-memory LRUs. After openportal restart, the LRU
  hydrates from SQLite on the first request per session/port. Cold
  reload while opencode is slow/down still renders the
  last-known-good chat instead of "OpenCode is unreachable".
  Future cacheable surfaces (agents/config/providers, bookmarks,
  pinned tabs, etc.) must follow the same pattern.

- **Append-only merge on cache writes.** `setCachedMessages` in
  `apps/web/src/server/lib/messages-cache.ts` merges new opencode
  responses with the existing cache entry by `info.id`. New
  messages REPLACE existing entries with the same id (parts may
  have grown as streaming continues); existing entries NOT in the
  new response are KEPT with `info._reconciling: true`. A stale-but-
  same-length opencode snapshot CANNOT drop a message we already
  saw. Sort order: ascending by `time.created`.

- **Authoritative-only invalidation.** Only these signals delete or
  trim cache entries:
    - SSE event `message.removed` / `message.part.removed`
      (handler in `apps/web/src/server/plugins/indicator-broadcaster.ts`
      calls `invalidateMessagesCache(sessionId)`)
    - SSE event `session.deleted` (same handler)
    - Explicit user action: revert, archive, delete, move
      (handlers in `apps/web/src/server/opencode/...` post-mutation)
  Timeouts, empty arrays from broken SDK calls, 5xx responses, and
  network blips MUST NOT touch the cache.

- **Reconciling badge for transient gaps.** When a cached entry is
  flagged `_reconciling=true`, the frontend renders it with an
  amber "Reconciling" pill + tooltip explaining the message is
  durably saved and the snapshot will catch up. Phase taxonomy:
  Submitting → Sent to OpenCode → Queued → Reconciling →
  (real message). NO phase reuses "Queued" semantics. Tooltips
  on each badge spell out what the phase means.

- **Per-write throttle on SQLite persistence.** Bun SQLite writes
  are synchronous. A 35MB messages_json blob written every SWR
  poll blocks the event loop and exhausts the browser's per-host
  connection pool (ERR_INSUFFICIENT_RESOURCES). The throttle
  (`PERSIST_THROTTLE_MS = 30000` per key in messages-cache.ts +
  sessions-cache.ts) coalesces writes to once per 30s per session/
  port. In-memory LRU updates on every set; SQLite is the
  restart-survival floor, not the live freshness tier.

- **Shrink-guard removed when merge landed.** Pre-merge, a
  defensive shrink-guard refused to overwrite a cached list with a
  shorter one. The merge subsumes that protection: output length
  is always >= max(old, new). Don't reintroduce the guard - merge
  is the canonical answer.

- **NEVER 503 when stale cache exists.** The messages handler
  returns 503 + `X-OpenPortal-OpenCode-Down: true` ONLY when the
  cache is genuinely empty AND opencode is unreachable. Frontend
  treats 503 as "opencode is down" and falls back to the
  StaleDataBanner. Returning 503 with a populated cache would
  flash the user out of the chat they're reading - explicit
  contract violation per the user's verbatim "you must not clear
  any loaded content when opencode connection sucks."

- **Routing decisions also go through cache.** The session-info
  modal, cohort/owner lookups, and prompt-routing all consult the
  cache before hitting opencode. Source-of-truth precedence is:
  authoritative opencode SSE event > local cache > opencode HTTP
  fetch > error. The fetch never updates the cache on the way
  back unless the response is authoritative (non-timeout, non-
  empty-from-bug).

When extending the caching layer for a new surface, the
implementation MUST:

  1. Read from in-memory LRU first
  2. Hydrate LRU from SQLite on miss
  3. Block + fetch from opencode only when both layers empty
  4. Merge fetched results with cached state by stable id (NEVER
     wholesale replace)
  5. Invalidate cache ONLY on authoritative removal signals
  6. Throttle SQLite writes proportional to payload size

If any of these aren't possible for a new surface, it doesn't
belong in this cache - figure out a different storage shape.

## Optimistic mutations + reconciliation overlay (binding)

OpenCode PATCH endpoints can take 0.5-6s to settle. Any user-initiated
mutation (archive, unarchive, rename, future delete / move / pin /
toggle / ...) that just awaits the round-trip and then refetches
produces a dead UI window the user reads as "did my click register?".
That window violates the **Async-action feedback** rule above. The
project's general answer is a three-layer pattern. EVERY mutating user
action must follow it.

### The three layers

1. **Server-side overlay** (`apps/web/src/server/lib/session-overlay.ts`).
   In-memory map keyed `port:sessionId`. Mutation endpoints set
   `_pending<Field>` (e.g. `_pendingArchived`, `_pendingTitle`) BEFORE
   awaiting opencode. The next `/sessions` GET applies the overlay
   onto every returned row, so OTHER tabs / concurrent polls
   immediately see the post-mutation state without any cross-tab
   coordination. A `reconcile()` pass clears entries opencode has
   caught up on (authoritative === pending), plus a 30s stale-safety
   drop in case opencode silently never reflects the mutation.
2. **Frontend resolver** (`apps/web/src/lib/session-overlay.ts`).
   `effectiveTitle(s)`, `effectiveArchivedAt(s)`,
   `isEffectivelyArchived(s)`, ... read `_pendingX` in preference to
   the raw authoritative field. UI code MUST go through the resolver
   - NEVER read `s.title` / `s.time.archived` / etc. directly. A
   reviewer inlining the resolver back to a direct field read
   re-introduces the bug.
3. **Originating-tab optimistic SWR patch + rollback**. The mutation
   hook (`useArchiveSession`, `useUnarchiveSession`, the rename
   submit handler, ...) patches the SWR cache for the relevant key
   (`/api/opencode/<port>/sessions` today) BEFORE firing the PATCH:
   sets `_pendingX` on the row locally with
   `mutate(key, updater, { revalidate: false })`. On success, fires a
   plain `mutate(key)` to revalidate (server returns the overlay-
   applied state). On error, mutates the cache back (deletes the
   `_pendingX`) AND records an error in
   `apps/web/src/stores/mutation-errors-store.ts`.

The three layers compose: layer 1 protects other tabs, layer 2
ensures the UI always reads through the right lens, layer 3 gives
the originating tab a zero-latency feel.

### Error recovery (mandatory)

Every optimistic mutation MUST surface its failure if the server
ultimately rejects it. The contract:

- On error: roll back the optimistic SWR patch in the same tab.
- On error: write a `MutationError` to the mutation-errors store
  keyed by sessionId. Include the field and a one-line message.
- On error: render `<MutationErrorIndicator sessionId={id} />` from
  `apps/web/src/components/mutation-error-indicator.tsx` adjacent
  to the affected control. The component renders a small warning
  triangle with the error message available via `title` (hover) /
  `aria-label` (tap / screen reader).
- On the next successful mutation for the same session, the
  indicator clears itself (the hook calls
  `useMutationErrorStore.getState().clearError(sessionId)` before
  staging the new optimistic patch).

### When to apply which response

| Round-trip cost | UX response |
|---|---|
| Sub-100ms, never fails meaningfully | Just await and refetch. Don't bother with optimism. |
| 100ms-3s, can fail (most mutations against opencode) | Three-layer pattern above. Apply immediately, server stages overlay, rollback + indicator on failure. |
| Multi-second waits with no graceful pre-confirm UI (rare) | Show a spinner / disabled state while waiting. Never freeze the UI silently. |

The rule: **if the originating tab is going to wait for the
backend before reflecting the user's change, the wait MUST be
visible (spinner / disabled state / progress text). If the tab
applies the change immediately, a failure MUST be visible and
recoverable.** No silent waits. No silent failures.

### Extension points

When adding a new mutating action that lives at the
`/sessions` surface (delete / move / pin / star / ...), follow the
pattern verbatim: add a new `_pending<Field>` to
`OverlayState` + `LooseSession`, teach `reconcile()` how to detect
"opencode caught up" for that field, add a new resolver function
in the client overlay module, wire the hook with optimistic patch
+ rollback + error-store integration. No new files unless the
storage shape genuinely doesn't fit (then read the cache section
above).

When adding a mutation against a DIFFERENT surface (messages,
permissions, plugin state), the same three layers apply but keyed
on that surface's primary record id. Build the new overlay store
in `apps/web/src/server/lib/<surface>-overlay.ts` with the same
shape contract.

## Never pre-generate opencode-assigned IDs (binding)

OpenPortal **MUST NOT** generate any ID that opencode is the canonical
owner of. This is a hard architectural invariant. Concretely:

- **Message IDs (`msg_...`)** - opencode stamps these on every user /
  assistant / system message. Portal MUST NOT supply `messageID` in
  `POST /session/:id/prompt_async` or `POST /session/:id/command`
  bodies. opencode's own ULID-style generator is the only legitimate
  source.
- **Session IDs (`ses_...`)** - opencode stamps these on
  `POST /session`. Portal MUST NOT supply `id` in the session-create
  body. `POST /session/:id/...` calls reference EXISTING server-
  assigned session IDs and are fine.
- **Part IDs (`prt_...`)** - opencode stamps these on every message
  part. Portal MUST NOT supply `partID` anywhere.
- **Any other server-assigned ID** - same rule.

### Why this is harmful

opencode's prompt-loop exit guard does a **lexicographic string
compare** between `lastUser.id` and `lastAssistant.id` to decide
"has this user message already been answered?". The compare works
ONLY when both IDs sort time-ascending - which is true for opencode's
own ULID-style IDs (hex timestamp prefix, currently `e6...` in 2026)
but NOT for any caller-supplied UUID. A `crypto.randomUUID()`-shaped
messageID has ~89% probability of sorting BELOW opencode's last
assistant ID, which fires the exit guard, exits the loop at step=0,
and silently swallows the prompt. The user-message row is created,
no assistant message is started, and stuck-detector classifies the
session as `verdict=stuck, cause=no-dispatch`. See
[ai-analysis-requests/STUCK_NO_DISPATCH_LEXICOGRAPHIC_ID_BUG.md](ai-analysis-requests/STUCK_NO_DISPATCH_LEXICOGRAPHIC_ID_BUG.md)
for the full forensic write-up of the bug this rule prevents.

Beyond the lex-compare trap, caller-generated IDs:

- Break opencode's "latest message" selection (every other place
  in opencode that orders by ID instead of `time.created` mis-ranks
  portal-stamped messages relative to server-stamped ones).
- Create non-monotonic histories that confuse any future indexer
  built on top of the message stream.
- Risk collisions across portal instances or across opencode
  instances that share storage.
- Introduce silent infinite loops in any opencode subsystem that
  reaches the "is X newer than Y" question via string compare.

### "But I need to correlate the archive row with the user message opencode emits"

That was the original justification for pre-generating `messageID`
(commit `b6cc833`, 2026-05-23). It is **not a valid justification.**
Correlation must be done via:

- **Text match** between the archive `raw_text` and the user
  message's parts (current `messages.ts` dedup pass 1).
- **Slash-command defence** for `/foo bar` archives whose opencode-
  emitted text shape differs from the literal keystroke (current
  `messages.ts` dedup pass 2).
- **Read-back correlation** - if a future feature needs a stable
  link from archive row to server-stamped messageID, populate the
  `opencode_message_id` column by reading the ID off the SSE
  `message.updated` event AFTER opencode has stamped it. Portal
  is the **caching proxy**, not the canonical generator. The
  archive `opencode_message_id` column exists for legacy rows and
  for this future read-back path; it MUST NEVER be populated by
  a portal-generated value.

### What MAY pass an ID to opencode (legitimate cases)

References to EXISTING server-assigned IDs are fine and required by
the opencode API itself:

- `POST /session/:id/fork` body `messageID` - fork-point on an
  existing message the client already saw.
- `DELETE /session/:id/message/:messageID` - delete an existing
  message.
- `POST /session/:id/revert` body `messageIDs` - revert existing
  messages.
- Path parameters like `:id` on session-scoped routes - the session
  ID was created earlier via `POST /session` and opencode echoed
  it back.

The distinction: **Portal NEVER mints; Portal MAY reference what
opencode minted.**

### Enforcement

- `apps/web/src/server/lib/prompt-archive.ts` `ArchiveInput` type
  no longer accepts `opencodeMessageId`. New rows always insert
  `opencode_message_id=NULL`. This kills the field at the type
  layer.
- `apps/web/src/server/plugins/pending-prompt-worker.ts` strips
  `messageID`, `sessionID`, `partID` from any legacy `payload_json`
  blob before replay, so historical rows never resurrect a
  pre-generated ID.
- `apps/web/src/server/opencode/[port]/session/[id]/prompt.ts` and
  `command.ts` send payloads with NO `messageID` field. Reviewer
  must reject any PR that adds `crypto.randomUUID()` /
  `randomUUID()` / `nanoid()` / `ulid()` near a `prompt_async`,
  `command`, or `session.create` call.
- Regression test:
  `apps/web/src/server/lib/prompt-archive.test.ts` asserts that
  `archivePrompt` writes `payload_json` WITHOUT a `messageID` field
  and `opencode_message_id=NULL`.

## Codebase environment

- OS: Arch Linux. Bun runtime. Tailscale networking.
- Public access:
  `https://portal.desktop.ts.nowaker.net:8443/` (Caddy reverse-proxy
  -> Portal `:5000` on tailnet).
- HTTP/2 keep-alive caveat: Bun client connection pool can hold
  stale sockets to a restarted backend; the connection-monitor +
  web-wrapper pair handles it.
