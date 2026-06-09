# Implementation Plan: Per-Session Managed opencode Instances + Master Instance

Status: PLAN ONLY — not implemented. Awaiting user review.
Author session date: 2026-06-08.

## 1. Motivation (verbatim user intent)

> i will soon be implementing a spawn-separate-opencode-serve-for-each-session
> feature. because a single opencode serve slows down to a crawl and loses
> workers as time goes by. given this, ... every session gets its own
> openportal managed opencode serve instance on a custom port. the instance
> is kept alive for a certain period of time after final assistant response
> (say 15 minutes - default - must be configurable in settings), then shut
> down for no user interaction. if the session is blocked on anything, like
> opencode question, permission request, anything else that awaits user
> interaction, or out of credits error with a retry timer, the instance is
> kept around indefinitely. if there's any error, like api error, anything
> where things didn't go right, keep it around too because api errors are
> tricky and not persisted through restarts (they don't land in chat log).
> additionally, openportal needs to spawn its own 'master' instance which
> will be used for session listings, and anything that isn't bound to any
> particular session. or, for use when session's opencode instance was
> terminated, but the action to call against the session is something
> irrelevant like rename session, archive, etc. (but if opencode instance
> still exists for that session, route these through that instance).
> ... i do want opencode detection on local and remote servers. maybe it's
> possible to connect to opencode api, and through its
> statistics/diagnostic endpoints, understand what sqlite database its
> running against, so then openportal knows how to spawn its managed
> instances, and doesn't need to rely on user-started opencode serve.
> do not implement - provide a big ass implementation plan.

This is the live problem observed during this session's QA: the active
opencode at `100.105.229.19:4096` intermittently failed the
`/api/instance/self` health probe ("Active OpenCode did not respond")
while still serving heavy reads through the resilient fetch path. A
single long-lived `opencode serve` accumulates load and degrades. The
fix is to stop multiplexing every session through one process.

## 2. Today's architecture (grounded in current code)

- **Lifecycle modes** (`AGENTS.md`, `packages/cli/src/index.ts`):
  `externalOpencode` > `decoupleOpencode` > legacy, plus the
  `--configless` flag (currently active in the systemd unit). Configless
  never spawns/attaches; the web UI talks to a registry of servers.
- **Server registry** (`apps/web/src/server/lib/server-registry.ts`):
  `listConfiguredServers()`, `getServerById(id)`, `getServerByPort(port)`,
  `addServer()`, `updateEphemeralEndpoint()`. Persisted in
  `~/.openportal/openportal.json` (`servers[]`, `activeServerId`).
- **Resolver** (`apps/web/src/server/lib/server-resolver.ts`):
  `resolveLiveEndpoint(server)` — for `ephemeral` servers, re-discovers
  the live host:port via process scan with a 2s TTL cache; for
  non-ephemeral, returns stored host:port + auth from `auth-store`.
- **Client + proxy** (`apps/web/src/server/lib/opencode-client.ts`):
  `fetchOpencode(port, path, init)` resolves the target **by port** via
  `resolveTarget(port)` → `getServerByPort(port)`. `getOpencodeClient` /
  `getOpencodeClientV2` build SDK clients keyed by port. Self-healing
  invalidate-and-retry on ECONNREFUSED/401.
- **Workers holding per-server `/event` SSE**:
  `auto-approve-worker.ts`, `indicator-broadcaster.ts`,
  reconcile loops keyed by `serverId`.
- **Caching proxy invariants** (`AGENTS.md`): `messages_cache`,
  `sessions_cache` in SQLite; authoritative-only invalidation. These let
  the UI render last-known-good even when an opencode is down — which is
  exactly what makes terminating idle instances safe.

### 2.1 The routing defect this plan must fix

`getServerByPort(port)` returns the **first** registry entry with that
port. Two opencodes sharing port 4096 (`srv-2dy1srwz` @ 100.105.229.19,
`srv-9myqtdk1` @ 192.168.10.10) are indistinguishable to every
`/api/opencode/[port]/*` route, because the frontend keys all calls by
`instance.port`. A permission asked on one server gets its reply POSTed
to the other. **The whole `[port]`-keyed proxy surface must move to a
stable, unique handle.** Per-session spawning makes ports ephemeral and
plentiful, so this is no longer optional — it is foundational.

Decision baked into this plan: **route by `serverId` (or a new
`instanceId`), never by raw TCP port.** Port becomes an internal detail
of the resolver.

## 3. Target architecture

### 3.1 Instance taxonomy

1. **Master instance** — one openportal-managed `opencode serve` bound to
   loopback on a fixed-ish port (e.g. `127.0.0.1:4600`, configurable).
   Used for: session listing, project enumeration, config/providers,
   and any session-scoped action that does NOT need the session's live
   in-memory state (rename, archive, move, delete, fork-point listing).
   Runs against the **same SQLite store** as the adopted user opencode so
   it sees all sessions.
2. **Session instances** — one openportal-managed `opencode serve` per
   *active* session, bound to loopback on an ephemeral port, against the
   same store. Created on demand (first prompt / first open that needs
   live state), torn down per the lifecycle state machine (§3.4).
3. **External/adopted instances** — optional: user-started opencodes we
   only talk to (today's configless model), kept for back-compat and for
   remote servers we cannot spawn on.

All managed instances are children of openportal and run under a
dedicated systemd slice (mirror the existing `opencode-sandbox.slice`
pattern) with memory caps so a runaway prompt cannot evict siblings.

### 3.2 The store-detection problem (how openportal learns where to spawn)

To spawn its own instances against the *same data* the user's opencode
uses, openportal must learn that opencode's data dir / SQLite path.
Options, in order of reliability:

- **(A) Process inspection (reliable, local only).** For a discovered
  local `opencode serve` pid: read `/proc/<pid>/environ` for
  `XDG_DATA_HOME` / `OPENCODE_DATA` (opencode stores under
  `$XDG_DATA_HOME/opencode` → `storage/`), and `/proc/<pid>/cwd`. Cross
  check with `lsof -p <pid>` for the open `*.db`/`storage` handles. This
  is how this session already mapped instances
  (`/proc/<pid>/cmdline`, `ss -ltnp`). **Recommended primary path.**
- **(B) opencode API self-description (needs verification).** Probe
  whether opencode exposes its data dir via an endpoint. Candidates to
  verify against the running build: `/app`, `/config`, a `/doctor` or
  `/diagnostics` route. NONE are confirmed to return the data dir today —
  **must be verified before relying on it.** If present, this is the only
  path that works for **remote** servers.
- **(C) Operator-declared (always works).** `/servers` lets the user
  declare a server's data dir + the `opencode` binary + spawn flags
  explicitly. Fallback when (A) is unavailable (remote) and (B) is
  unconfirmed.

Spawn command shape (to verify against the pinned opencode build):
`opencode serve --hostname 127.0.0.1 --port <ephemeral>` with
`XDG_DATA_HOME` / `XDG_CONFIG_HOME` set to match the adopted instance, so
the new process shares `storage/` and sessions. **Open question:** does
opencode tolerate N concurrent `serve` processes over one SQLite store?
SQLite WAL allows multi-process readers + one writer; opencode's
per-session writes rarely overlap across distinct sessions, but this MUST
be load-tested (see §6 risks).

### 3.3 Instance registry + router (new server-side module)

Introduce `instance-manager.ts` (server-side, singleton) owning:

- `Map<sessionId, ManagedInstance>` and one `master: ManagedInstance`.
- `ManagedInstance = { id, kind: "master"|"session"|"external", host,
  port, pid?, sessionId?, dataDir, status, lastActivityAt,
  keepAliveReason?, spawnedByUs: boolean }`.
- `getInstanceForSession(sessionId)`: returns the session instance if
  alive; else (for state-free actions) the master; else spawns a session
  instance (for actions needing live state).
- `resolveForRequest({ sessionId?, requiresLiveState })`: the single
  entry point the proxy uses. Replaces `getServerByPort`.

`opencode-client.ts#resolveTarget` is rewritten to consult
`instance-manager` keyed by `instanceId`/`sessionId` instead of port.
`fetchOpencode` signature migrates from `(port, path)` to
`(instanceRef, path)` where `instanceRef` is `{ sessionId }` or
`{ instanceId }`. Port is resolved internally.

### 3.4 Session-instance lifecycle state machine

States: `spawning → ready → idle → draining → stopped`, plus a sticky
`retained` overlay.

- **Spawn triggers:** first prompt to a session whose instance is not
  alive; opening a session that needs live state (active streaming,
  pending permission/question) when only the master exists.
- **Idle timer:** starts at the **final assistant response** (turn
  completes, no queued work). Default **15 min**, configurable in
  Settings (`settings.instanceLifecycle.idleShutdownMinutes`). On expiry
  with no interaction → `draining` (let SSE flush) → `stopped` (SIGTERM,
  then SIGKILL fallback). Mirror prod openportal's `TimeoutStopSec`
  semantics.
- **Indefinite retention (`retained`)** — never auto-stop while ANY of:
  - session blocked on a **permission** ask (we now have a durable
    signal: `permission_events` rows with `status='pending'`, shipped in
    `f48e386`), or a **question** (opencode question awaiting reply), or
    any other interaction-awaiting state;
  - **out-of-credits / retry-timer** error active (retry pending);
  - **any error state** (API error, etc.) that is NOT persisted to the
    chat log — because killing the instance would lose the only copy of
    that error. Detect via the indicator stream's error/`opencode_retry`
    fields already broadcast by `indicator-broadcaster.ts`.
- **Reactivation:** any new prompt/interaction on a `stopped` session
  re-enters `spawning`.

The keep-alive decision is computed from signals openportal already
tracks (indicator state per session + the new permission_events table),
so the manager polls/subscribes to those rather than inventing new ones.

### 3.5 Master instance responsibilities + routing rule

- Always-on (supervised; respawn on crash).
- Handles: `/session` list, `/project`, `/config`, `/config/providers`,
  and session-scoped **state-free** mutations: rename
  (`PATCH /session/:id`), archive/unarchive, move, delete, fork-point
  reads, export.
- **Routing rule (verbatim intent):** if the session's own instance is
  alive, route session-scoped calls THROUGH it; otherwise, if the action
  is state-free, route through master; otherwise spawn the session
  instance. Encode as `requiresLiveState` per route (a static table:
  prompt/command/abort/permission/question ⇒ live; rename/archive/move/
  delete/list ⇒ state-free).

### 3.6 Workers under many instances

`auto-approve-worker` and `indicator-broadcaster` currently open one
`/event` SSE per configured server. Under per-session spawning that
becomes one SSE per live instance. The manager must:

- open/close the worker SSE connections in lockstep with instance
  spawn/stop (extend the existing reconcile loops to iterate
  `instance-manager` instead of `listConfiguredServers`);
- ensure the **master** SSE covers global events;
- guarantee permission/question capture survives instance churn — the
  durable `permission_events` table already decouples the rendered log
  from instance lifetime, which is why that feature was built first.

## 4. /servers page rework

Today `/servers` is a flat registry of host:port entries. Target:

- **Three sections:** (1) Managed-by-openportal (master + live session
  instances, read-mostly, with per-instance status/port/pid/keep-alive
  reason + a manual "stop now" / "keep alive" pin); (2) Adopted external
  opencodes (user-started, detected); (3) Discoverable hosts (local +
  remote) you can adopt or designate as a spawn target.
- **Per host: spawn capability.** For a host where openportal can spawn
  (local, or remote with declared binary + data dir), show "Manage here"
  — openportal will spawn master + session instances on it. For hosts
  where it cannot, fall back to today's talk-only adoption.
- **Store detection UI:** surface the detected data dir (method A/B/C),
  let the operator confirm/override, and store it on the server record
  (`dataDir`, `opencodeBin`, `spawnFlags`).
- **Remote spawning** (stretch): spawn via SSH using existing per-server
  SSH creds (`ssh_creds.ts`, `auth-store`). Plan but gate behind a flag;
  local-first.

Everything stays URL-addressable per the "everything is a permalink"
rule (`?server=` / new `?instance=`), and uses the visual-framework
components (no native widgets).

## 5. Settings additions

`settings.instanceLifecycle` namespace (new typed module mirroring
`instance-settings-state.ts`):
- `idleShutdownMinutes: number` (default 15)
- `masterPort: number | null` (default auto)
- `maxConcurrentSessionInstances: number | null` (cap; LRU-evict idle
  ones beyond cap, never evict `retained`)
- `spawnEnabled: boolean` per server (managed vs talk-only)
HTTP route `/api/instance-lifecycle` (GET/PUT) + a `stores/` hook +
Settings tab section, following the documented pattern.

## 6. Risks / open questions (MUST resolve before building)

1. **Concurrent opencode processes over one SQLite store.** WAL permits
   it, but opencode may assume single-writer or cache state in-process.
   ACTION: load-test N `serve` over one `storage/` (writes from 2
   sessions in parallel; watch for `SQLITE_BUSY`, lost updates, corrupt
   `message`/`part` rows).
2. **opencode data-dir discovery API (path B) is unconfirmed.** ACTION:
   enumerate the running build's routes; if none expose the data dir,
   remote managed-spawn depends on operator declaration (path C).
3. **Port exhaustion / cleanup on crash.** Orphaned children if openportal
   dies mid-spawn. ACTION: pidfile per instance under
   `~/.openportal/instances/`, reap on startup (the legacy-mode orphan
   problem already documented in AGENTS.md).
4. **Spawn cost / cold-start latency.** First prompt now waits for a
   spawn. ACTION: measure; consider a warm master handling the first
   turn while the session instance spawns, then hand off.
5. **The port→instanceId migration touches every `/api/opencode/[port]/*`
   route + the frontend port handle.** Large, cross-cutting. ACTION:
   phase it (see §7) with a compatibility shim that maps a legacy `port`
   to an `instanceId` during transition.
6. **Routing decisions vs caching-proxy invariants.** Keep-alive/teardown
   must never drop cache; cache already survives instance death by
   design — verify the master can always serve list/read from cache when
   a session instance is down.

## 7. Phased rollout (suggested)

- **P0 (prereq, mostly shippable now):** route by `serverId`/`instanceId`
  instead of `getServerByPort`. Fixes the 4096 collision independently of
  spawning. This is the smallest correct step and de-risks everything
  after.
- **P1:** `instance-manager` + master instance, configless still adopts
  the user opencode as the store source; master spawned against detected
  data dir (path A locally). No per-session spawn yet — all traffic to
  master. Validates spawn + store-sharing.
- **P2:** per-session spawn + lifecycle state machine + retention signals
  (permission/question/error). Workers follow instance churn.
- **P3:** `/servers` rework + Settings + remote managed-spawn (SSH).
- **P4:** drop reliance on user-started `opencode serve` where managed
  spawn is available.

## 8. What was built first (and why) — context for this plan

The durable permission log (commit `f48e386`, `permission_events` +
synthetic `source: vibekick / kind: permissions` messages) shipped ahead
of this plan precisely because **per-session teardown requires a durable,
instance-independent record of permission asks + answers**. Without it,
killing an idle instance would lose pending-permission state and the
chat-log audit. That feature also provides the `status='pending'` signal
the lifecycle state machine reads for indefinite retention (§3.4).
