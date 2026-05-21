# Opencode-compatible API bridge - design doc

User voice (paraphrased): "open portals API is totally independent from
open code API ... API bridge ... under a specific path like for example
/opencode would expose a fully compatible open code API ... internally
translate those calls back to open portal calls ... strip all the unneeded
content".

Rationale: any tool / SDK / dashboard / IDE plugin that targets the
opencode HTTP API should be able to point at openportal (substituting the
mount path) and Just Work. Today openportal speaks its own API
(`/api/...`) and proxies opencode via `/api/opencode/<port>/...`. The
proxy is shaped like openportal's API, not opencode's - so an opencode
SDK consumer pointed at openportal cannot operate.

## Architecture

Mount a new namespace at `/opencode` (mirroring the opencode CLI's own
`opencode serve` HTTP API verbatim). Every opencode endpoint at
`<opencode-host>:<port>/<path>` becomes
`http://<openportal-host>:<port>/opencode/<path>` with the same method,
query, body, response shape, and headers.

Two sub-paths:

  /opencode/active/<path>            -> the currently-active server
  /opencode/server/<srv-id>/<path>   -> a specific server registry entry

The "active" variant is for clients that don't care which server (single-
server use case). The "server" variant supports openportal's multi-server
fan-out: the client picks which server it's driving.

## Implementation surface

opencode-serve exposes ~35 endpoints across these namespaces (current as
of opencode 1.15.6):

| Namespace | Endpoints | openportal proxy status |
|---|---|---|
| `/event` | SSE stream | ALREADY at `/api/opencode/<port>/event` |
| `/app` | `/init`, `/log`, `/agent`, `/command`, `/mode` | partial (`/agent` ALREADY) |
| `/config` | `/`, `/providers` | ALREADY |
| `/session` | `GET/POST /`, `GET/POST/PATCH/DELETE /:id`, `/:id/abort`, `/:id/share`, `/:id/unshare`, `/:id/summarize`, `/:id/message`, `/:id/message/:msgID`, `/:id/init`, `/:id/command`, `/:id/prompt`, `/:id/permissions/:id`, `/:id/fork`, `/:id/revert`, `/:id/unrevert`, `/:id/shell` | MOSTLY proxied via `/api/opencode/<port>/session/...` |
| `/file` | `/list`, `/content`, `/search`, `/status` | partial |
| `/find` | `/symbol`, `/text`, `/file` | NONE |
| `/snapshot` | `/`, `/diff`, `/restore` | NONE |
| `/tui` | `/control/request`, `/control/response`, `/append-prompt`, `/open-help`, `/open-sessions`, `/open-themes`, `/open-models`, `/submit-prompt`, `/clear-prompt`, `/execute-command`, `/show-toast` | NONE |
| `/log` | `POST /` | NONE |
| `/auth` | `GET`, `PUT`, `DELETE` | NONE |
| `/project` | `GET /current` | ALREADY |

So ~70% of the surface is already proxied via the `/api/opencode/<port>/`
namespace, but reshaped: openportal's wrapper applies its own validation
(`apps/web/src/server/lib/validation.ts`), strips fields it doesn't need
(`apps/web/src/server/opencode/[port]/session/[id]/messages.ts:290`
documents the strip rules), and sometimes injects synthetic data (the
indicator broadcaster's view of session state).

A compat bridge that does NOT do any of those transformations is the
right shape for the user voice spec ("expose a fully compatible
opencode API ... strip all the unneeded content" - I read that as
"DO strip on openportal's normal API, but DO NOT strip on the compat
bridge").

## Bridge mount design

```
apps/web/src/server/opencode-compat/active/[...path].ts
apps/web/src/server/opencode-compat/active/[...path].post.ts
... (per HTTP verb)
apps/web/src/server/opencode-compat/server/[srv]/[...path].ts
... (per HTTP verb)
```

Handler logic:
1. Resolve port from "active" (read instance store) or "server/[srv]"
   (read server registry).
2. Strip the prefix from `event.path` to get the opencode-relative path.
3. `fetchOpencode(port, path, { method, headers, body, query })`.
4. Pass the upstream response through verbatim: status, headers
   (minus hop-by-hop), body bytes.

SSE / chunked transfer needs special handling: don't buffer the
opencode `/event` response, stream chunks through to the client as
they arrive. nitro's h3 supports this via setting up a ReadableStream
on the H3Response.

## Open design questions

These need user input before implementation:

1. **Authentication shape**. opencode's HTTP API has no auth by default
   (it binds to loopback). openportal's compat bridge running on the
   tailnet IP would be exposing those endpoints to every peer on the
   tailnet. Either:
   - (a) bind compat bridge to loopback only, so it's local-only;
   - (b) require the same UI-password gate as the OpenChamber model;
   - (c) match opencode-mcp's auth header pattern;
   - (d) honour the same presence-tracker rules as the sudo dispatch.
2. **Multi-server "active" semantics**. If the user is viewing
   server A but the compat client is running on a different host,
   should "active" mean openportal's active-server-for-this-tab,
   or the host's last-touched server? Probably the latter (the
   compat client doesn't have a browser tab to bind to).
3. **Field-strip override**. openportal's existing
   `/api/opencode/<port>/...` proxy strips fields. The compat bridge
   would NOT strip - but should there be a query opt-in to strip
   (saves bandwidth for clients that don't want raw data)?
4. **Indicator broadcaster**. openportal sees a richer view of session
   state via the broadcaster than opencode itself does (pending
   prompts on the openportal side, etc). Compat bridge should ignore
   this entirely or expose it as an extension namespace?

## Scope estimate

- Routing layer (mount path + verb handlers): ~6 hours.
- Per-namespace handler implementations (most are just `fetchOpencode`
  passthroughs): ~4 hours.
- SSE / stream passthrough on the bridge: ~3 hours.
- Auth model decision + implementation: ~4 hours.
- Integration tests against a real opencode-sdk client: ~3 hours.

**Total: ~20 hours of focused work.**

Status: NOT shipped. This is too large for an autonomous turn and the
auth-model + multi-server-semantics questions in the "Open design
questions" section need user input before committing. Documented here
so the next session has a starting point.
