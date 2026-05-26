# Session prompt directory routing

## TL;DR

openportal session prompts arrive at opencode without a `?directory=`
query param or `x-opencode-directory` header. opencode's
workspace-routing middleware then falls back to its own `process.cwd()`,
which under the user's systemd unit is `WorkingDirectory=%h/projekty` =
`/home/<user>/projekty`. The shell tool inherits that cwd, so `pwd`
returns `/home/nowaker/projekty` instead of the session's actual
worktree (e.g. `/home/nowaker/projekty/webapps/portal`). The AI then
thrashes trying to figure out which project it is in.

This is an **openportal bug**, not an opencode bug. opencode's API
contract is "every request that needs an InstanceContext must declare
its directory in URL/header." openportal's session creation respects
the contract (`POST /session?directory=…`), but the subsequent
session-scoped POSTs (`/prompt`, `/command`, …) do not.

## Reproduction

Session `ses_199f94180ffeYBjaI0fuz5pfGw` on 2026-05-26 at 15:43 CT.

Prompt:

> portal: Sync chat prompts to navbar highlight
>
> make the user prompts in chat log the same color as the highlighted
> session in navbar when active.
> like this color-mix(in oklab,var(--primary)15%,transparent)
>
> remember to reuse components/definitions. don't hardcode.
>
> perform on a worktree. merge to master when ready.

Tool calls the AI made:

1. `pwd && ls -la` → returned `/home/nowaker/projekty` + listing of
   that parent directory (NOT the portal project).
2. `ls /home/nowaker/projekty/nowaker/`
3. `ls /home/nowaker/projekty/nowaker/opencode-tools/`
4. `ls /home/nowaker/projekty/ai-workspace/`
5. `ls /home/nowaker/projekty/webapps/`

The AI's reasoning text on turn 1:

> I need to understand what project we're working with and what
> changes are needed—making user prompts match the active session
> highlight color using an existing color variable rather than
> hardcoding it. Let me start by looking at the project structure to
> get my bearings.

The AI was lost because it did not know which project the session was
bound to.

Session DB state (correct - this is NOT the bug location):

```
$ sqlite3 ~/.local/share/opencode/opencode.db \
  "SELECT id, directory, workspace_id, project_id FROM session \
   WHERE id = 'ses_199f94180ffeYBjaI0fuz5pfGw';"

ses_199f94180ffeYBjaI0fuz5pfGw|/home/nowaker/projekty/webapps/portal||e99d5e0eb7be2fe688ff7dd54f9daf04e5e8426f
```

- `directory = /home/nowaker/projekty/webapps/portal` ✓
- `workspace_id = null`
- `project_id = e99d5e0eb7be2fe688ff7dd54f9daf04e5e8426f`

So the session's metadata correctly captured the project worktree.
The bug is that opencode does not consult `session.directory` at
request-handling time.

## Where the directory comes from at request time

`packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts`
at v1.15.10:

```ts
function defaultDirectory(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
): string {
  return url.searchParams.get("directory")
    || request.headers["x-opencode-directory"]
    || process.cwd()
}
```

And in `planRequest`:

```ts
return RequestPlan.Local({
  directory: defaultDirectory(request, url),
  workspaceID: envWorkspaceID ?? workspaceID,
})
```

Note: the `routeHttpApiWorkspace` wrapper DOES look up the session by
id, but it only feeds `session?.workspaceID` into `planRequest`, never
`session?.directory`:

```ts
const sessionID = getWorkspaceRouteSessionID(requestURL(request))
const session = sessionID
  ? yield* Session.Service.use((svc) => svc.get(sessionID))…
  : undefined
const plan = yield* planRequest(request, session?.workspaceID)
```

So for a session with `workspace_id = NULL` (the user's setup -
configless mode, single local opencode), `planRequest` falls into the
`Local` branch and `defaultDirectory()` fires. Without the request
carrying `?directory=` or `x-opencode-directory`, opencode lands on
its own `process.cwd()`.

The user's `opencode-serve-tailscale.service` unit sets
`WorkingDirectory=%h/projekty`, so `process.cwd()` is
`/home/nowaker/projekty`. That's the wrong directory for every
session in every project.

## Where the InstanceContext is consumed (= where the bug surfaces)

`packages/opencode/src/server/routes/instance/httpapi/middleware/instance-context.ts`:

```ts
const route = yield* WorkspaceRouteContext
const ctx = yield* store.load({ directory: decode(route.directory) })
return yield* effect.pipe(
  Effect.provideService(InstanceRef, ctx),
  Effect.provideService(WorkspaceRef, route.workspaceID),
)
```

`InstanceStore.load({ directory })` builds the per-directory
`InstanceContext` (project lookup, vcs probe, etc.) and stamps it as
`InstanceRef` for the handler tree.

`packages/opencode/src/tool/shell.ts` line 611-615:

```ts
const instanceCtx = yield* InstanceState.context
const cwd = params.workdir
  ? yield* resolvePath(params.workdir, instanceCtx.directory, shell)
  : instanceCtx.directory
```

`instanceCtx.directory` IS `route.directory` IS
`defaultDirectory(request, url)`. So the bash tool's cwd is the
request's URL-or-header-derived directory. When openportal omits
both, the cwd defaults to `process.cwd()` = wrong.

## Why session creation worked but prompt POST didn't

openportal session creation already passes `?directory=` (it has to -
without a directory there's no InstanceContext to associate the new
session with):

```ts
// apps/web/src/server/opencode/[port]/session/create.ts
const session = await client.session.create({
  body: { title: body.title, parentID: body.parentID },
  query: body.directory ? { directory: body.directory } : undefined,
});
```

But `POST /session/{id}/prompt_async` and
`POST /session/{sessionID}/command` did NOT thread the directory:

```ts
// apps/web/src/server/opencode/[port]/session/[id]/prompt.ts
//   - direct dispatch (when archive filter drops the prompt)
await client.session.promptAsync({
  path: { id },
  body: payload,
});

// apps/web/src/server/plugins/pending-prompt-worker.ts
//   - background delivery for archived prompts (the path the bug
//     reporter actually hit)
await client.session.promptAsync({
  path: { id: row.session_id },
  body: payload,
});

// apps/web/src/server/opencode/[port]/session/[id]/command.ts
//   - slash-command dispatch via v2 SDK
const result = await client.session.command({
  sessionID,
  command, arguments, agent, model, variant, messageID,
});
```

None of these pass `query.directory` (or `directory` flat for v2).
Result: opencode's workspace-routing middleware falls back to
`process.cwd()`.

## SDK supports the parameter on every affected endpoint

`@opencode-ai/sdk@1.2.27`:

```ts
export type SessionPromptAsyncData = {
  body?: { … };
  path: { id: string };
  query?: { directory?: string };  // <- here
  url: "/session/{id}/prompt_async";
};

export type SessionCreateData = {
  body?: { … };
  query?: { directory?: string };  // <- already used in create.ts
  url: "/session";
};
```

v2 SDK `session.command`:

```ts
command<ThrowOnError extends boolean = false>(parameters: {
  sessionID: string;
  directory?: string;  // <- flat param
  workspace?: string;
  …
});
```

So the SDK has always accepted the directory; openportal just wasn't
passing it on session-scoped POSTs.

## Fix

Centralized helper `resolveSessionDirectory(port, sessionId)` in
`apps/web/src/server/lib/opencode-client.ts`:

- Look up `session.directory` once per `(port, sessionID)` via GET
  `/session/<id>`.
- Cache 5 minutes (the directory is immutable for a session's
  lifetime in practice).
- Best-effort: on lookup failure return `undefined` and the caller
  falls through with no directory header. The bug surface is then no
  worse than the pre-fix state.

GET `/session/<id>` is "local action" in opencode's workspace-routing
rules (`server/shared/workspace-routing.ts` `RULES`), so it does NOT
itself need a directory header. That breaks the chicken-and-egg
cycle.

The helper is threaded into the three known session-scoped dispatch
paths:

1. `apps/web/src/server/opencode/[port]/session/[id]/prompt.ts`
   - the `archivePrompt` filter-bypass branch (direct dispatch).
   - the `detectStuckFromRestart` background `session.abort` call.
2. `apps/web/src/server/plugins/pending-prompt-worker.ts` - the
   background delivery path that the bug reporter actually hit.
3. `apps/web/src/server/opencode/[port]/session/[id]/command.ts` -
   slash-command dispatch.

After this fix, every session-scoped POST carries
`query.directory = session.directory`. opencode's
`defaultDirectory()` reads from URL params, falls into the right
branch, and the shell tool runs in the session's actual project
worktree.

## Tradeoffs considered

- **Send `x-opencode-directory` header from `fetchOpencode` automatically**
  by parsing session IDs out of URLs - rejected as too magical and
  too easy to break with future URL patterns.
- **Pass directory from the frontend** (the React app does know the
  session's directory via SWR cache) - rejected as it leaks an
  implementation detail (opencode's routing model) to the frontend
  and requires touching every fetch site.
- **Store directory on the prompts archive table** so the worker has
  it without a lookup - reasonable but adds a column + migration;
  the helper's cache makes the lookup cost negligible
  (~1 HTTP call per session lifetime).
- **Change opencode to fall back to `session.directory`** - the
  cleanest root-cause fix, but it's an opencode change and was not
  authorized by the user's prompt ("if an openportal bug, fix on a
  worktree, merge to master afterwards"). Worth filing upstream
  separately as a long-term hardening.

## Open questions

- **Other session-scoped opencode endpoints** also depend on
  `InstanceContext`: `/abort`, `/compact`, `/revert`, `/archive`,
  `/fork`, `/messages` (SSE), `/todo`, `/cost-breakdown`. They
  currently use the unscoped client and would benefit from the same
  fix, but most are GET requests where the directory doesn't change
  observable behaviour (the route stays "local" and the handler does
  not invoke the shell tool). Fix scope was intentionally kept to
  the prompt/command path because that's the reported bug; a sweep
  through all session-[id]/*.ts handlers is a follow-up.
- **Companion plugin's emit path** likely needs the same threading
  for any sidecar that POSTs back to opencode under a session id.

## Verification plan

1. Build the worktree: `bash scripts/build.sh` → new bundle hash.
2. Deploy via `bash scripts/deploy.sh` (dev → prod gate).
3. From an active session in any project, send a prompt asking the
   AI to run `pwd`.
4. Expect: `pwd` returns the session's project worktree, not
   `/home/nowaker/projekty`.
5. Also send a slash command (`/init` or similar) and verify the
   bash tool runs in the right cwd.

Pre-fix baseline for the same test: `pwd` returns
`/home/nowaker/projekty`. Direct repro is
`ses_199f94180ffeYBjaI0fuz5pfGw`.
