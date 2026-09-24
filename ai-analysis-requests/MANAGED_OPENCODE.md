# Managed opencode — architecture and gap analysis

Status: as-built audit + design doc + gap analysis. The feature is partially
implemented in the working tree (uncommitted on `main-nowaker` at audit
time). Nothing in here proposes code; it describes what already exists, how
it behaves, and where it diverges from the originating spec
`SPAWN_PER_SESSION_OPENCODE.md`.

Every architectural claim cites file:line of the real code. Empirical
opencode behavior was verified by spawning `opencode` 1.17.8 from
`~/projekty/webapps/opencode-build/bin/opencode` at a pre-allocated
loopback port and inspecting `/doc`, `/`, `/api/location`, and the
process command line — then killing it.

## 1. Goal and out-of-the-box workflow

OpenPortal historically NEVER spawned opencode — README, principles, line
12-17: *"Configless first. OpenPortal never starts opencode for you."*
The user runs `opencode serve` somewhere; openportal binds to it through
the server registry; the two lifecycles are independent.

"Managed opencode" is an ADDITIVE workflow. When the user creates a
session and the active server is on a local interface, openportal also
spawns a fresh `opencode serve` of its own and routes that session's
traffic through it instead of the user's instance. The user-managed
opencode workflow keeps working unchanged; managed simply takes over for
sessions opened against a local source port.

User intent verbatim — `ai-analysis-requests/SPAWN_PER_SESSION_OPENCODE.md`
lines 8-31: per-session managed instance; idle shutdown after 15min
(configurable); keep alive indefinitely while blocked (permission /
question / out-of-credits / API error); a master instance for
session-listing and other unbound actions, plus a "fall back to master
when the session's instance is gone but the action is state-free"
routing rule; opencode-database detection on local AND remote servers.

The as-built code implements the per-session spawn skeleton and the
parent/child sub-session routing. It does NOT implement the idle timer,
the keep-alive signal taps, the master instance, or the database
detection. See §10 for the precise gap list.

## 2. As-built architecture

One library module owns the feature:
`apps/web/src/server/lib/managed-opencode.ts` (494 lines). It is wired
into 16 integration points plus 2 new HTTP routes and 1 SQLite migration.

### 2.1 The library module

`managed-opencode.ts`:

| Concern | Symbol | Lines | Behavior |
|---|---|---|---|
| Constants | `MANAGED_HOST`, `READY_TIMEOUT_MS`, `READY_POLL_MS` | 16-18 | `127.0.0.1`, 15000ms, 200ms |
| Process registry | `children: Map<pid, ChildProcess>` | 49 | In-memory; lost on openportal restart |
| Local-host gate | `localHosts()`, `sourcePortIsLocal()` | 60-74 | Walks `networkInterfaces()` + the literal `localhost / 127.0.0.1 / ::1` |
| Feature gate | `managedSessionSpawningEnabled(sourcePort)` | 76-81 | Env `OPENPORTAL_MANAGED_SESSION_OPENCODE` ∈ `{0/false/off → off, 1/true/on → on}`, default = true only when the source server is local |
| Binary resolution | `opencodeBinary()` | 83-92 | env `OPENPORTAL_MANAGED_OPENCODE_BIN` → `~/projekty/webapps/opencode-build/bin/opencode` → `opencode` on PATH |
| Port allocation | `allocatePort()` | 94-108 | `net.createServer().listen(0, "127.0.0.1")`, read assigned port, close, return. Deterministic — the port is then passed explicitly to opencode as `--port N`. No stdout parsing. |
| Readiness probe | `waitUntilReady()` | 110-132 | Polls `GET http://127.0.0.1:<port>/` every 200ms until `res.ok`, 15s deadline. Failure raises a descriptive `Error`. |
| Cleanup hooks | `registerCleanupHandlers()` | 134-154 | One-time init (`initialized` flag at 50). On `exit/SIGINT/SIGTERM`: SIGTERM every child, then forward the signal to itself via `process.kill(pid, signal)` after detaching the once-handler. |
| Row CRUD | `getRow`, `upsertRow`, `deleteRow`, `childRows`, `collectDescendants` | 156-232 | `managed_opencode_instances` table; upsert by `session_id`. `collectDescendants` BFS-walks `parent_session_id`. |
| Liveness | `rowIsLive`, `pidMatchesManagedInstance` | 204-251 | Live = pid is in `children` map OR `/proc/<pid>/cmdline` contains `opencode` + `serve` + `--hostname` + host + `--port` + port. |
| Reaper | `reapStaleRows()` | 272-278 | Iterates the table; for non-live rows: `removeServer(server_id)` + delete row. |
| Parent walk | `lookupParentId`, `resolveManagedRow` | 280-324 | For a session whose row is missing or stale, ask opencode `/session/:id` for `parentID`, recurse, and on a live ancestor materialize a child row pointing at the parent's server/host/port/pid. |
| Routing | `resolveManagedRoutingTarget` | 326-337 | Public entry used by `prompt-routing.ts`. Returns `{ host, port, ownerInstanceUrl }` or `null`. |
| Spawn / bind | `startPendingManagedInstance`, `bindManagedSession`, `stopPendingManagedInstance`, `stopManagedSession`, `parentManagedInstance` | 347-478 | See §3. |
| Listing | `listManagedInstances`, `listManagedInstanceStatus` | 480-493 | The status variant reaps stale rows first, then annotates `live`. |

`OPENCODE_URL` is exported into the child's env (line 371) pointing at
the child's OWN URL — used by any subprocess the child launches
(plugins/mcps) so they talk back to the same serve. `--log-level` is
configurable via env `OPENPORTAL_MANAGED_OPENCODE_LOG_LEVEL`, default
`INFO` (356). Stdout/stderr are line-prefixed and forwarded to
openportal's stdout (339-345, 374-375), which goes into the systemd
journal under the openportal unit — there is no per-instance log file.

### 2.2 The SQLite table

`apps/web/src/server/lib/migrations/0008_managed_opencode_instances.sql`
(18 lines):

```sql
managed_opencode_instances (
  session_id        TEXT PRIMARY KEY,
  parent_session_id TEXT,
  source_port       INTEGER NOT NULL,   -- the user's active-server port at create-time
  server_id         TEXT NOT NULL,      -- the registry ID for the managed server entry
  host              TEXT NOT NULL,      -- 127.0.0.1
  port              INTEGER NOT NULL,   -- allocated loopback port
  pid               INTEGER,            -- nullable; only NULL when spawn failed pre-bind
  directory         TEXT,               -- cwd recorded for the spawn
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
)
CREATE INDEX idx_managed_opencode_instances_parent  ON ...(parent_session_id);
CREATE INDEX idx_managed_opencode_instances_server  ON ...(server_id);
```

Registered in `apps/web/src/server/lib/prompt-db.ts:13,30` as migration 8
(`TARGET_VERSION = 8`). Runs in the same SQLite handle as the rest of the
openportal state at `~/.local/share/openportal/openportal.db`. Single-
process WAL, same writer rules as every other table.

### 2.3 Two HTTP routes

`apps/web/src/server/managed-opencode/instances.get.ts` — `GET
/api/managed-opencode/instances` returns `{ instances: ManagedInstanceRow
& { live: boolean }[] }`, via `listManagedInstanceStatus()` which reaps
stale rows first.

`apps/web/src/server/managed-opencode/instances/[sessionId].delete.ts` —
`DELETE /api/managed-opencode/instances/:sessionId` calls
`stopManagedSession(sessionId)` (§3.5). Returns `{ found, stopped,
removedSessions }`.

These are the operator surface. Neither route is consumed by the
frontend yet (no UI calls grep on either path).

### 2.4 The 16 integration points

Two integration patterns:

**Pattern A — owner-routing override** (12 sites). `resolveOwner(sessionId)`
in `prompt-routing.ts:96-112` now accepts a `fallbackPort?` parameter and
checks `resolveManagedRoutingTarget()` BEFORE the existing
stuck-detector-plugin lookup (lines 100-103). Every site that already
called `resolveOwner` for cohort routing now passes the source port too,
so managed routing takes priority over cohort routing. Sites updated to
pass the second argument:

| File | Symbol | Purpose |
|---|---|---|
| `apps/web/src/server/lib/messages-refresh.ts:115-118` | `doFetchAndCache` | Read-side: messages list goes to the managed instance |
| `apps/web/src/server/plugins/pending-prompt-worker.ts:80` | `deliverOne` | Worker that replays queued prompts after restart |
| `apps/web/src/server/plugins/unknown-finish-reviver.ts:37` | `sendPromptAsyncRevive` | Stuck-session revival |
| `apps/web/src/server/opencode/[port]/session/[id]/prompt.ts:120` | prompt dispatch | New prompts on existing sessions |
| `apps/web/src/server/opencode/[port]/session/[id]/command.ts:70` | command dispatch | `/foo bar` slash commands |
| `apps/web/src/server/opencode/[port]/session/[id]/abort.ts:16` | abort | Stop the running turn |
| `apps/web/src/server/opencode/[port]/session/[id]/compact.post.ts:43` | compact | Summarization run |
| `apps/web/src/server/opencode/[port]/session/[id]/index.delete.ts:11-13` | delete | Plus `stopManagedSession` (Pattern C) |
| `apps/web/src/server/opencode/[port]/session/[id]/index.get.ts:47-49` | session.get | Single-session read |
| `apps/web/src/server/opencode/[port]/questions.ts:33-38` | question list | Threads `?sessionId=` into the owner lookup |
| `apps/web/src/server/opencode/[port]/question/[requestId]/reply.ts:17-19` | question reply | Reads `sessionId` from body |
| `apps/web/src/server/opencode/[port]/question/[requestId]/reject.ts:17-19` | question reject | Reads `sessionId` from optional body |

The corresponding frontend hook in `apps/web/src/hooks/use-opencode.ts`
(575-665) was extended to thread `sessionId` through every permission /
question call so the server side can do the owner lookup.

**Pattern B — spawn-and-bind** (1 site):
`apps/web/src/server/opencode/[port]/session/create.ts`. Decision tree in §3.1.

**Pattern C — explicit teardown** (1 site):
`session/[id]/index.delete.ts` calls `stopManagedSession(id)` post-ack
and invalidates the sessions cache on both ports.

That is the entire integration surface as of HEAD.

## 3. Lifecycle state machine

State sequence:
`spawn-requested → pending (process up, server registry row exists, no
managed_opencode_instances row yet) → bound (row written) → live
(serving) → reaped (process gone or /proc cmdline mismatch)`.

Failure off the `pending → bound` edge runs `stopPendingManagedInstance`
(`managed-opencode.ts:413-420`): `removeServer` + SIGTERM the child; no
row is ever written.

### 3.1 Spawn — `session/create.ts`

Decision tree the route runs before talking to opencode:

1. `body.parentID` set → `parentManagedInstance(parentID, port)` walks
   the parent chain; on a live ancestor, `targetPort` becomes the
   parent's port. The new session is created through the parent's
   instance.
2. else `managedSessionSpawningEnabled(port)` true → call
   `startPendingManagedInstance({ sourcePort, directory, title })` and
   `targetPort` becomes the freshly allocated loopback port.
3. else (remote source port, or env-disabled) → no managed action;
   `targetPort = port`.

Then `getOpencodeClient(targetPort).session.create(...)`. On success,
`bindManagedSession({ sessionId, instance, parentSessionId?, sourcePort,
directory, title })` writes the row: case 1 (`body.parentID` set) binds
the parent's instance with `parent_session_id = body.parentID`; case 2
(fresh spawn) binds the pending instance with `parent_session_id =
null`. On failure: `stopPendingManagedInstance` for case 2 (case 1
leaves the parent alone), then rethrow.

Cache invalidation is unconditional on the source `port` and additional
on `targetPort` when it differs.

### 3.2 Port allocation

The reference design for "never hardcode the port": `allocatePort`
(94-108) opens an `net.createServer().listen(0, "127.0.0.1")`, reads the
OS-assigned port via `server.address().port`, closes the listener, and
returns the integer. The spawned `opencode` is then started with `--port
<N>` as an explicit argument. There is a TOCTOU window between
close-listener and child-binds, but on loopback under normal load the
kernel does not reassign that port out from under the about-to-bind
child within sub-millisecond reuse. Confirmed empirically: a freshly
spawned `opencode --log-level INFO serve --hostname 127.0.0.1 --port
36249` logs `opencode server listening on http://127.0.0.1:36249`
verbatim — the port is exactly what we pre-allocated. Default `--port 0`
(opencode would pick its own random port) is NEVER used by managed
spawn; the code always passes the pre-allocated number.

### 3.3 Readiness

`waitUntilReady(port)` polls `GET http://127.0.0.1:<port>/` (the SPA
HTML, NOT `/api/health`) on 200ms intervals with a 200ms in-flight
abort per probe (`READY_POLL_MS`) and a 15s overall deadline. Failure cause is captured as
`HTTP <status>` or the fetch error message and surfaced in the thrown
Error. Verified empirically: a healthy opencode answers `/` with the
SPA HTML and a 200, satisfying `res.ok`.

### 3.4 Registry registration

On readiness, `startPendingManagedInstance` calls
`addServer({ label: "Managed: <title|sessionId-prefix>", protocol:
"http", host: "127.0.0.1", port, ephemeral: false })`
(394-400). De-dup in `server-registry.ts:313-340` is by `(host, port)`,
so re-spawning into the same loopback port returns the prior entry. The
returned `server.id` (a generated ULID-ish string) is what the row
stores; everything downstream looks up by `server_id`, NOT by port.

Label rewrites happen at `bindManagedSession` time
(`updateServer(row.server_id, { label: ... })` at 463-469).

### 3.5 In use → death

There is NO active watchdog on the spawned process. The CLI's existing
external-opencode resilience monitor (`packages/cli/src/index.ts:349-371`)
watches the user's opencode and exits openportal (`process.exit(2)`) on
prolonged unreachability — it does not look at managed instances. There is also no
health-monitor module under `apps/web/src/server/lib/` that flips
managed-instance state or respawns; `cohort-registry.ts` exists but
deals with cross-instance owner consensus, not managed lifecycle.

Death is detected LAZILY in three places:

- `rowIsLive(row)` is checked on every `resolveManagedRow` (304). If the
  row exists but the child is dead and `/proc/<pid>/cmdline` no longer
  matches, the row + registry entry are deleted in-place (306-309) and
  the parent walk continues; the session falls through to the source
  port. This is the hot-path purger.
- `reapStaleRows()` runs at the top of every
  `startPendingManagedInstance` (353) and every
  `listManagedInstanceStatus` (489). It iterates the whole table and
  drops anything not live.
- Process-side: the spawned child's `exit` event removes its pid from
  the `children` map (383-385), so subsequent `rowIsLive` calls fall
  through to the `/proc` cmdline check.

No "orphan adoption on openportal startup" path exists. After a
restart, the in-memory `children` map is empty; the SQLite rows still
hold the old pids; `/proc/<old_pid>/cmdline` may still match if the
child outlived openportal — in that case `rowIsLive` returns `true` and
the row is honored. If not, the row is reaped on first access.

### 3.6 Graceful shutdown

`registerCleanupHandlers()` (134-154) installs once-handlers for `exit`,
`SIGINT`, `SIGTERM`. On a signal: `stopChildren()` sends `SIGTERM` to
every entry in the `children` map, removes the signal handler, then
re-raises the signal via `process.kill(process.pid, signal)`. The
process exits with the conventional signal exit code. No SIGKILL
fallback, no per-child wait timer. If a managed child ignores SIGTERM
(rare for opencode), it lingers until reaped externally — typically by
systemd's default `KillMode=control-group` (the openportal unit sets no
explicit `KillMode`), which hammers the whole process group on
shutdown.

### 3.7 Restart adoption — partial

After an `openportal.service` restart:
- `children` is empty;
- managed_opencode_instances rows still exist with their old pids;
- if an old `opencode serve` child outlived openportal (legitimate when
  systemd kills openportal hard but not its children, or when
  `KillMode=process` is in effect — NOT the current config), the
  `/proc/<pid>/cmdline` check at `pidMatchesManagedInstance` (234-251)
  re-validates the row and the session keeps routing through it;
- the openportal process has NO file descriptor to that orphan, so it
  cannot signal it cleanly on the NEXT shutdown — the orphan would
  outlive a second restart too. Only the systemd cgroup teardown
  guarantees the child dies with the parent unit.

This is the closest thing to "adoption" the code has today. It is
implicit, not designed.

## 4. Per-session and parent/child routing

The unit of management is THE SESSION, not the project. Each top-level
session gets its own opencode process. Sub-sessions (sessions created
with `parentID` set — sidebar shows the purple subsession glyph per
README) reuse the parent's managed instance.

### 4.1 Parent reuse

`session/create.ts:31-33`:
```ts
if (body.parentID) {
  parentInstance = await parentManagedInstance(body.parentID, port);
  if (parentInstance) targetPort = parentInstance.port;
}
```

`parentManagedInstance(parentSessionId, fallbackPort)` (473-478) is just
a wrapper around `resolveManagedRow` — it walks the parent chain by
asking opencode `/session/:id` for the `parentID` of each step until it
hits a session with a live managed row, then materializes a row for the
intermediate sessions that pointed back to that root. Cycles are
guarded by a `Set` of seen ids (302).

On bind, `bindManagedSession` writes the child row with
`parent_session_id = parentSessionId` and reuses the parent's
`server_id`, `host`, `port`, `pid`, and `directory`. Both rows now
point at the same registry entry.

### 4.2 Subsession teardown

`stopManagedSession(sessionId)` (422-440):
- If the row has a `parent_session_id`, it deletes ONLY the child row
  and returns `{ found: true, stopped: false, removedSessions: 1 }` —
  the parent process keeps running.
- If the row is a root, it collects descendants
  (`collectDescendants`), SIGTERMs the process via `stopRowProcess`,
  removes the server registry entry, and deletes ALL rows in the
  subtree. `stopped` reflects whether the SIGTERM landed.

### 4.3 Master / unbound-action instance

NOT IMPLEMENTED. The originating spec § 3.1 calls for an always-on
master opencode used for: session listing, project enumeration,
config/providers, and session-scoped state-free mutations (rename,
archive, move, delete) when the session's own managed instance is gone.

In the as-built code, unbound actions still flow through the user's
active-server port (the `port` URL parameter of every
`/api/opencode/<port>/*` route, supplied by the frontend's
`usePort()`). The originating-spec routing rule "session instance alive
→ use it; gone but action is state-free → use master; gone and state-
ful → spawn a session instance" is partially realized:

- "alive → use it" — yes, via the owner-routing override
  (`resolveManagedRoutingTarget`).
- "gone but state-free → use master" — there is no master, so the
  request falls back to the user's active-server port. For genuinely
  state-free actions (list, rename) this works; it just is not the
  master.
- "gone and stateful → spawn a session instance" — NOT IMPLEMENTED.
  A second prompt to a session whose managed instance has died is
  routed to the user's active-server port and that opencode owns the
  next turn. The session keeps streaming, but the per-session
  isolation goal is silently abandoned.

See § 10 for the explicit gap.

## 5. Multi-project: one instance, many directories

opencode resolves the target workspace per-request from `?directory=`,
then header `x-opencode-directory`, then `process.cwd()`
(`opencode/packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:87`;
comment at `cli/cmd/serve.ts:10`: *"Server loads instances per-request
via x-opencode-directory header — no need for an ambient project
InstanceContext at startup"*). Empirically
verified against opencode 1.17.8.

Implications:

- Managed children are spawned with `cwd: input.directory ||
  process.cwd()` (`managed-opencode.ts:367`). Default workspace = the
  session's creation-time directory.
- `session.create` threads `query.directory`. Most subsequent calls
  rely on the session-stored `directory` field, so they route correctly
  even without re-threading the param.
- One process CAN serve every session in a project — the code chooses
  per-top-level-session instead. Tradeoff: process count + spawn cost
  vs. per-session isolation (the originating motivation). Granularity
  is hardcoded; no setting flips it.

## 6. Configuration: `opencode.json` (ONLY)

opencode reads its own configuration from `~/.config/opencode/` and the
canonical config file is `opencode.json`. The managed child inherits
the same lookup paths as a user-started `opencode serve`:

- Global: `~/.config/opencode/opencode.json`.
- Workspace: `<cwd>/opencode.json` (or `<cwd>/opencode.jsonc`).
- Verified empirically: spawning the binary with no extra env reads
  the same `opencode.json` openportal's user-mode opencode reads.

Managed spawn does NOT pass any config override:
- env (`managed-opencode.ts:369-372`) is `{ ...process.env, OPENCODE_URL
  }` — every variable openportal had is forwarded. No
  `XDG_CONFIG_HOME` override, no `OPENCODE_CONFIG` override.
- args (`357-365`) carry only `--log-level`, `serve`, `--hostname`,
  `--port`. The `--pure` flag (would disable plugins) is NOT used —
  plugins load identically to the user's manual `opencode serve`.

There is intentionally NO `the-assistant.json` or any other
non-`opencode` config name; on disk EVERYTHING is `opencode`. The
product is being rebranded in the UI; the binary, config file, config
dir, and data dir are all literally `opencode`.

## 7. Data dir: shared `~/.local/share/opencode/storage`

opencode roots its data at `Global.Path.data` = `~/.local/share/opencode`.
Evidence: `storage/storage.ts:224` (storage), `session/prompt.ts:81`
(compaction debug log, hardcoded path), `auth/index.ts:10`,
`mcp/auth.ts:37`, `snapshot/index.ts:79`, `worktree/index.ts:224`.

Consequences:

- Managed children inherit openportal's env, so the data dir is shared
  with every other opencode on the box (user's manual `serve`, any
  sandboxed instance, CLI invocations). Cross-instance session
  visibility comes for free.
- Concurrent SQLite writers from N processes over one storage dir is
  the explicit risk in `SPAWN_PER_SESSION_OPENCODE.md` § 6.1. WAL
  allows multi-reader + one writer per file; cross-session writes
  rarely overlap, but the compaction-debug log
  (`session/prompt.ts:81`) is a process-shared append target.
  UNVERIFIED; load test must precede shipping.
- Isolation (distinct `XDG_DATA_HOME` per child) removes contention
  but loses shared history. Not implemented; would require a
  cross-cutting opencode-aware change.

## 8. Networking

Bind: `127.0.0.1` only. `MANAGED_HOST` is the literal constant at line
16; it is the listen address for every spawned child and also the
target of the readiness probe. `addServer` is called with the same
literal (397).

Exposure: never. Managed instances are an internal implementation
detail; they MUST NOT be reachable from outside loopback. The
originating spec does not call for exposure; nothing in the integration
surface assumes it. If a future feature wanted to expose a managed
instance (e.g. for remote pair-debugging), it would need a separate
explicit code path; today the listen address is hardcoded.

The user's active opencode (the "source port") may be on any host —
including a remote tailnet peer. When it is, `sourcePortIsLocal(port)`
returns `false` and `managedSessionSpawningEnabled` falls back to
`false`, so no managed spawn happens. The session is owned by the
remote user-managed opencode the way it always was.

## 9. Registry + frontend integration

Managed instances are ordinary server registry entries:
`ephemeral: false`, label `Managed: <title|sessionId-prefix>`, persisted
in `~/.openportal/openportal.json`. Implications:

- Persistence on disk survives restart; the child does not (unless it
  outlived per § 3.7).
- They appear in every frontend that iterates `listConfiguredServers()`
  (`/servers`, topbar, Ctrl+K palette) — no filter, no badge, no
  managed-only UI suppression.
- The JSON is read-modify-written under no lock; the deployment is
  single-user so this is latent (cf. § 10).

Neither managed-opencode HTTP route is consumed by the frontend yet.

## 10. Gap analysis vs `SPAWN_PER_SESSION_OPENCODE.md`

The originating spec sets out ten concrete behaviors. Honest scoring:

| # | Spec behavior | Status | Evidence |
|---|---|---|---|
| 1 | Per-session managed opencode | DONE | `startPendingManagedInstance` + `bindManagedSession` in `session/create.ts`. Top-level sessions get their own process. |
| 2 | Sub-sessions reuse the parent's instance | DONE | `parentManagedInstance` + `resolveManagedRow` walk parent chain; child row is materialized. |
| 3 | Idle shutdown after 15 min | NOT IMPLEMENTED | No timer, no `last_activity_at` column. Teardown only via explicit session delete, spawn-failure rollback, or post-mortem reap. |
| 4 | Idle-timeout configurable in Settings | NOT IMPLEMENTED | No `settings.instanceLifecycle` namespace; no `/api/instance-lifecycle` route. |
| 5 | Keep alive while blocked (permission/question/credits/error) | NOT APPLICABLE YET | Prerequisite #3. No subscription to indicator-broadcaster state or `permission_events` to compute "blocked"; no signal sink. |
| 6 | Master instance for listings + state-free actions | NOT IMPLEMENTED | No `kind: master`. Session listing + rename/archive route through the user's active-server port. |
| 7 | Master fallback when session's instance is gone | NOT IMPLEMENTED | No master. Fallback is the user's active-server port. Stateful actions on a dead managed instance silently de-manage the session. |
| 8 | opencode-DB detection on local/remote | NOT IMPLEMENTED | Code never asks any opencode where its data dir is. Managed children share `~/.local/share/opencode/storage` by env inheritance only. `/api/location` exists but UNVERIFIED whether it returns the data root. No `dataDir` field on `ConfiguredServer` for path C. |
| 9 | Routing by `serverId` instead of raw TCP port | NOT IMPLEMENTED | The `[port]` collision defect (`SPAWN_PER_SESSION_OPENCODE.md` § 2.1) persists. Managed entries get unique loopback ports so they don't collide in practice, but the proxy surface is unchanged. |
| 10 | Port re-resolution on respawn | NOT APPLICABLE YET | No respawn path; a dead instance is reaped, next prompt routes to source port. |

Additional defects:

- **Registry write race**: `addServer/removeServer/updateServer`
  (`server-registry.ts:313-373`) do unlocked read-modify-write of
  `~/.openportal/openportal.json`. Concurrent user edit via `/servers`
  + managed spawn = lost write. Latent under single-user deployment.
- **No watchdog on the spawned child's `exit`**: nothing observes the
  death, nothing surfaces it, the user sees the next prompt silently
  route to the source port instead.
- **No orphan adoption on startup**: § 3.7 — an outliving managed
  opencode keeps serving (cmdline still matches) but the new
  openportal process has no fd to signal it. Orphans accumulate
  across restarts. Fix: enumerate rows on startup, validate pid via
  `pidMatchesManagedInstance`, install a sentinel in `children`.
- **Workers (`auto-approve-worker`, `indicator-broadcaster`)
  iterate the registry**: managed entries show up in
  `listConfiguredServers()`, so workers open SSE to them — but the
  workers do not follow the managed lifecycle (no open on spawn, no
  close on reap). UNVERIFIED in this audit.
- **One kill switch only**: `OPENPORTAL_MANAGED_SESSION_OPENCODE`
  is all-or-nothing per process. No per-server "Manage here" toggle
  per spec § 4.

## 11. Open questions

- **N concurrent `serve` processes over one `~/.local/share/opencode/storage`
  — viable?** UNVERIFIED. SQLite WAL allows multi-reader + one writer
  per file; cross-session writes rarely overlap, but the compaction-debug
  log (`session/prompt.ts:81`) is a process-shared append target. Must
  load-test before adding idle-shutdown / master, because the whole
  design pivots on this answer.
- **Does `/api/location` return the data root?** Endpoint exists in
  opencode 1.17.8's `/doc`; content not queried. Determines whether
  remote data-dir detection (spec path B) is viable or whether C
  (operator-declared) is the only remote option.
- **Master: shared or isolated data dir?** Spec wants shared (so master
  sees user sessions); same contention question as above with
  always-on consequences.
- **Crash mid-prompt — explicit recovery?** Today: SSE drops, message
  half-streamed, next prompt silently re-routes to the source port.
  Spec calls for keep-alive on errors but is silent on crash recovery.
- **Granularity: per-session vs per-project?** Per-project amortizes
  spawn cost and matches opencode's per-request directory routing, but
  loses per-session blast-radius isolation.
- **"Configless first" vs managed spawn.** Principle still holds for
  remote source ports (gated by `sourcePortIsLocal`); locally inverted.
  README needs updating.
- **/servers UI: split or relabel?** Spec § 4 wants three sections;
  today managed entries share the flat list with a `Managed:` prefix.

## 12. Summary

The 494-line library + 16 integration sites + 2 routes + 1 migration
deliver the per-session managed spawn skeleton and the
parent/child sub-session routing. The originating spec's lifecycle
behavior (idle timer, keep-alive on blocked / error / credits, master
instance, opencode-DB detection, serverId routing) is NOT YET
implemented. The infrastructure that exists is sound — the SQLite
table is well-shaped, the parent walk is correct, the registry
integration reuses existing primitives, port allocation is
deterministic. The next milestone is the idle timer plus a master
instance, both of which require a signal sink the current code does
not have.
