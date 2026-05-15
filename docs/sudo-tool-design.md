# Companion-plugin sudo tool — design

Status: design only, implementation pending. Captured in this session
because the feature is multi-piece (MCP sidecar + opencode wiring +
openportal endpoint + web password UI) and benefits from a fixed
contract before code lands.

## Why this is needed

Some legitimate AI-driven work requires `sudo` (system service
restarts, package installs, /etc edits, etc.). Today the only path
is for the user to type the password inline or for the AI to ask and
wait. That's clumsy and leaks the password into the chat transcript.

The presence-detection work (commit `41cf268`) gave the AI a reliable
signal of whether the user is physically at this computer or on a
remote tailnet peer. This lets us split the sudo flow:

| Scenario | Path |
|---|---|
| `client.isLocal=true` (browser on this host, or curl from loopback) | spawn a GUI password dialog via `SUDO_ASKPASS=/bin/ksshaskpass sudo -A …`. User sees a desktop popup, types password into a native input, never crosses HTTP. |
| `client.isLocal=false` (remote tailnet peer) | openportal pops a password modal in the web UI, ferries the entry via HTTPS over Tailscale, pipes it to `sudo -S` via stdin. Password is in-memory only, never logged, never written to disk. |

## Architecture

Three new pieces, plus a small amendment to the existing companion
plugin:

```
            (1) opencode-side MCP sidecar          (2) openportal endpoints
            ┌────────────────────────┐             ┌────────────────────────────┐
LLM         │  openportal-sudo-mcp   │             │  POST /api/sudo/run        │
asks for    │  (stdio MCP server     │ ─── HTTPS ─▶│   - look up client.isLocal │
sudo_bash ─▶│   spawned by opencode  │             │   - if local: spawn        │
            │   via mcp config)      │             │     sudo -A with           │
            │                        │             │     ksshaskpass            │
            │  Exposes one tool:     │             │   - if remote: enqueue,    │
            │    sudo_bash(cmd)      │             │     wait for browser to    │
            │                        │             │     POST password         │
            │  Calls openportal HTTP │             │     /api/sudo/answer/:id  │
            │  to do the actual run  │             │     then sudo -S          │
            └────────────────────────┘             │   - capture stdout/stderr  │
                                                   │   - return to MCP sidecar  │
                                                   └────────────────────────────┘
                                                              ▲
                                                              │
                                              (3) web UI password modal
                                              ┌──────────────────────────┐
                                              │  PendingSudoModal.tsx    │
                                              │  - polls or subscribes   │
                                              │    /api/sudo/pending     │
                                              │  - shows command preview │
                                              │  - input + submit POSTs  │
                                              │    /api/sudo/answer/:id  │
                                              │  - never persists pwd    │
                                              └──────────────────────────┘
```

### (1) openportal-sudo-mcp

Lives under `~/projekty/nowaker/opencode-tools/openportal-sudo-mcp/`
to match the convention of the other sister plugins. Standalone
TypeScript MCP server using `@modelcontextprotocol/sdk` (stdio
transport). Exposes one tool:

```
sudo_bash(command: string, reason: string)
  -> { exit_code: number, stdout: string, stderr: string }
```

Implementation: POST `command` + `reason` to
`http://localhost:5000/api/sudo/run`, await JSON response, return
the captured exit code + streams. Reason is an LLM-supplied
justification surfaced in the web prompt so the user knows what
they're approving.

Registered in `~/.config/opencode/opencode.json` `mcp` section:

```jsonc
{
  "mcp": {
    "openportal-sudo": {
      "type": "local",
      "command": [
        "bun",
        "/home/nowaker/projekty/nowaker/opencode-tools/openportal-sudo-mcp/src/index.ts"
      ],
      "enabled": true
    }
  }
}
```

opencode picks up the new MCP, the tool becomes available to the AI.

### (2) openportal endpoints

#### `POST /api/sudo/run`

Body: `{ command: string, reason: string }`.

1. Read `event` → `detectClient(event)` → `client.isLocal`.
2. If `isLocal=true`:
   - Spawn `sudo -A -p "" -- bash -c "<command>"` with env
     `SUDO_ASKPASS=/bin/ksshaskpass DISPLAY=:0
     XAUTHORITY=/home/nowaker/.Xauthority`. ksshaskpass pops a
     dialog on the desktop; user types and OK; sudo proceeds.
     The MCP sidecar is awaiting the HTTP response.
   - Capture stdout/stderr, return `{ exit_code, stdout, stderr,
     channel: "gui" }`.
3. If `isLocal=false`:
   - Generate `request_id` (uuid).
   - Insert a row into a new in-memory map: `pendingSudo` with
     `{ request_id, command, reason, created_at, deferred: Promise }`.
   - Wait (`await deferred.promise`) for the browser to POST the
     password to `/api/sudo/answer/:request_id`.
   - On password arrival: spawn `sudo -S -- bash -c "<command>"`,
     pipe password to stdin, capture streams, resolve the deferred,
     return `{ exit_code, stdout, stderr, channel: "web" }`.
   - Timeout: if no password in 5 minutes, reject with `{ exit_code: -1,
     stderr: "sudo prompt timed out", channel: "web" }`.

#### `GET /api/sudo/pending`

Returns the in-memory `pendingSudo` map for the browser to poll
(or SSE if we want sub-second pickup). Per-entry shape:
`{ request_id, command, reason, created_at, age_ms }`.

#### `POST /api/sudo/answer/:request_id`

Body: `{ password: string }`. Looks up the deferred, resolves it
with the password. Wipes the password from memory after handing to
sudo. Returns `{ ok: true }`.

### (3) Web UI password modal

`apps/web/src/components/sudo-prompt-modal.tsx`. SWR-polls
`/api/sudo/pending` every 1s (or subscribes to a new SSE event if
we add one). When a request is pending, renders a modal with:

- the **command** in a code block (so user can see exactly what
  will run)
- the **reason** (LLM-supplied justification)
- a password `<input type="password">` with autofocus
- Approve / Deny buttons

On Approve: POST the password, close modal. On Deny: POST a special
"deny" marker so the deferred rejects with "user denied", sudo never
runs.

Insert the modal mount in `_app.tsx` near the existing
ConnectionStatusBanner so it works on every route.

## Security constraints (NON-NEGOTIABLE)

1. **Never log the password.** Not to console, not to file, not to
   journald. The sudo invocation is `sudo -S` reading from stdin —
   any logging of the sudo command itself must redact the input.
2. **Never put the password in `argv`.** That would leak to every
   process via `/proc/<pid>/cmdline`. Pipe via stdin only.
3. **Always require HTTPS** when the modal POSTs the password. That's
   already covered by the Caddy reverse-proxy chain
   (`portal.desktop.ts.nowaker.net:8443`).
4. **Bind the command to the request.** Don't let the browser
   answer a stale request_id with a password for a different
   command — the request_id <-> command binding is enforced on the
   server side; the browser only ever sends `password` for `:id`.
5. **Wipe password from memory** after `sudo -S` consumes it. Use
   `password = ""` in the closure scope; don't retain the buffer.
   Bun's GC will collect.
6. **Honour deny.** A denied request rejects the deferred so the
   MCP sidecar's HTTP call returns immediately with the LLM seeing
   an explicit denial, not a timeout.
7. **5-minute hard timeout.** No request can hang forever. Browser
   tab closed = automatic timeout.
8. **No command without reason.** The MCP sidecar must require both
   parameters; an empty reason is a 400 from the server.

## Phasing

Phase A — backend plumbing only:
- `apps/web/src/server/sudo/run.post.ts` (the dispatcher)
- `apps/web/src/server/sudo/pending.get.ts`
- `apps/web/src/server/sudo/answer/[request_id].post.ts`
- In-memory `pendingSudo` map module
- Unit-test the local-GUI path against a stub sudo

Phase B — MCP sidecar:
- New repo subdir under opencode-tools
- Standalone TS MCP server
- Wire into `~/.config/opencode/opencode.json`
- Restart opencode-serves; verify the tool appears in `/tools` listing

Phase C — Web UI:
- `SudoPromptModal` component
- SWR poll of `/api/sudo/pending`
- Mount in `_app.tsx`

Phase D — Validation:
- Local path: AI calls `sudo_bash`, ksshaskpass dialog appears, type
  password, command runs, stdout returns to AI.
- Remote path: AI calls `sudo_bash`, web modal appears, type
  password, command runs, stdout returns to AI.
- Deny path: AI calls, user clicks Deny, AI sees rejection.
- Timeout path: AI calls, user ignores, after 5 min AI sees timeout.
- Permission denied path: command itself fails, AI sees the sudo
  error in stderr.

Each phase is independently shippable. A-B-C-D in order; A alone
unlocks the GUI-only path which is already useful for the local-
desktop case.

## Pairs with existing infrastructure

- `apps/web/src/server/lib/client-detection.ts` — already gives us
  `client.isLocal` from `detectClient(event)`. The trust model is
  documented in the portal AGENTS.md "Network trust + presence
  detection" section.
- `apps/web/src/server/companion-plugin/restart-with-sudo.post.ts`
  is the precedent for the stdin-piped sudo pattern (see the
  existing companion-plugin install-and-restart flow). The web-
  password capture modal is a refinement of the modal already used
  there — same shape, generalised.
- The auto-approve modal precedent (chat-side approval widget)
  shows the SWR+modal pattern for a per-session prompt.

## Out of scope (for now)

- Allow-listing specific commands (e.g. only let the LLM ask for
  `systemctl restart …` not arbitrary bash). Add later as a
  config-driven filter in the run endpoint.
- Audit log of every sudo invocation. Worth adding — straightforward
  append to a new SQLite table or a flat log file, with
  request_id + command + exit code + timestamp + channel.
- Granting sudo persistently for a session ("auto-approve sudo for
  the next 5 minutes" akin to the auto-approve permissions toggle).
  Useful follow-up after the base flow lands.


## MCP vs native tool

### Short answer
Keep MCP for `sudo_bash`.
The sudo tool is a tiny proxy around openportal HTTP, so MCP buys process isolation and reuse with almost no extra complexity.
A native plugin would be lower-latency, but it would run inside opencode's heap and tie sudo logic to opencode internals.

### Comparison

| Axis | Native opencode tool | MCP stdio sidecar |
|---|---|---|
| Process model | Runs in the opencode process after the plugin module is imported. | Runs as a separate child process over stdio, or as a remote MCP server. |
| Crash blast radius | A bug is shared with opencode. | A bug is isolated to the sidecar process. |
| Startup / lifecycle | Loaded when opencode loads plugins from config. | Spawned when the MCP config is connected. |
| Hot reload | I found no plugin-registration watcher; config changes are picked up on reload/restart. | Tool lists can refresh when the server emits `ToolListChangedNotification`. |
| Latency | Lowest. No subprocess hop. | Slightly higher because of stdio JSON-RPC, but still tiny next to HTTP + sudo + human approval. |
| Permissions | Same model applies because plugin tools become normal prompt tools. | Same model applies, and MCP tools also call `ctx.ask(...)` before execute. |
| Schema / typing | Plugin authors write Zod args; opencode converts them to JSON Schema for the model. | MCP exposes `inputSchema`; opencode wraps that into JSON Schema for the model. |
| Language support | JS / TS only, inside opencode's runtime. | Any language or even a remote URL, because the config accepts `command` or `url`. |
| Cross-process fit | Fine for `fetch()`, but it couples the privileged action to opencode. | Better fit: `sudo_bash` is already a separate privileged boundary that proxies to openportal HTTP. |
| Best fit for sudo | Okay, but not necessary. | Best. The tool is a thin transport, so the extra process boundary is worth it. |

### Why MCP was chosen

- `openportal-sudo-mcp` is already a standalone stdio server that registers one tool, `sudo_bash`, and forwards the request to `/api/sudo/run` ([source](https://github.com/Nowaker/openportal/blob/c82a1f50c8b82d5f228d5e297063c61f750a9c42/docs/sudo-tool-design.md#L59-L95)).
- opencode already treats MCP as a first-class config surface with local `command` and remote `url` entries ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/config/mcp.ts#L4-L50)).
- Native tools are in-process, so the best-case win is only a small latency reduction, while the downside is shared failure and tighter coupling to opencode's runtime ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/plugin/index.ts#L97-L108)).

### Source anchors

#### Native tool API in opencode

- `tool?: { [key: string]: ToolDefinition }` on plugin hooks, plus `tool.definition` for post-definition mutation ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/plugin/src/index.ts#L222-L227), [source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/plugin/src/index.ts#L330-L332)).
- `tool({ description, args, execute })` is the native tool helper; args are Zod schemas ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/plugin/src/tool.ts#L46-L55)).
- opencode imports plugin modules and converts their tool map into runtime tools ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/plugin/index.ts#L97-L108), [source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/tool/registry.ts#L203-L208), [source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/tool/registry.ts#L136-L185)).
- The model receives JSON Schema, not raw Zod or description text ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/session/prompt.ts#L565-L579), [source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/tool/registry.ts#L318-L345)).

#### MCP tool path in opencode

- Local MCP servers are spawned via `StdioClientTransport` with a command array; remote MCP servers are `type: "remote"` URLs ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/config/mcp.ts#L4-L50), [source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/mcp/index.ts#L412-L445)).
- opencode converts MCP `inputSchema` to JSON Schema and wraps each MCP call in `ctx.ask(...)` before execution ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/mcp/index.ts#L657-L690), [source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/session/prompt.ts#L608-L627)).
- MCP tool lists refresh when the server sends `ToolListChangedNotification` ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/mcp/index.ts#L499-L510)).
- Permission filtering still applies at prompt construction time via `Permission.disabled(...)` on the merged tool set ([source](https://github.com/anomalyco/opencode/blob/1dffc042ecf5d993180df6f9867b0adf0386ce39/packages/opencode/src/session/llm.ts#L451-L457)).

#### Native plugin examples

- Daytona's opencode plugin builds a tool map in JS and each tool file exports `description`, `args`, and `execute` ([source](https://github.com/daytonaio/daytona/blob/e6df13b5013bdb0f2483cc85f18884ef08c351b6/libs/opencode-plugin/.opencode/plugin/daytona/tools.ts#L25-L44), [source](https://github.com/daytonaio/daytona/blob/e6df13b5013bdb0f2483cc85f18884ef08c351b6/libs/opencode-plugin/.opencode/plugin/daytona/tools/ls.ts#L12-L31)).
- Suna's PTY plugin registers multiple tools in one plugin return object ([source](https://github.com/kortix-ai/suna/blob/c1aa270846776bcfb50896671c53d43394c403fa/core/kortix-master/opencode/plugin/kortix-system/pty-tools.ts#L71-L118)).
- Suna's connectors and caveman plugins follow the same `tool: { ... }` shape ([source](https://github.com/kortix-ai/suna/blob/c1aa270846776bcfb50896671c53d43394c403fa/core/kortix-master/opencode/plugin/kortix-system/connectors.ts#L31-L98), [source](https://github.com/kortix-ai/suna/blob/c1aa270846776bcfb50896671c53d43394c403fa/core/kortix-master/opencode/plugin/opencode-caveman-plugin/opencode-caveman-plugin.ts#L75-L118)).
- The openportal companion plugin is telemetry-only: it returns hook handlers and never exposes a `tool` field ([source](https://github.com/Nowaker/openportal/blob/c82a1f50c8b82d5f228d5e297063c61f750a9c42/packages/openportal-companion-plugin/src/index.ts#L293-L424)).

#### MCP server examples

- `openportal-sudo-mcp` is a stdio MCP server that registers `sudo_bash` and forwards to openportal HTTP ([source](https://github.com/Nowaker/openportal/blob/c82a1f50c8b82d5f228d5e297063c61f750a9c42/docs/sudo-tool-design.md#L59-L95)).
- Playwright MCP runs as a stdio server with `Server` + `StdioServerTransport` ([source](https://github.com/executeautomation/mcp-playwright/blob/2349c2891e7c499c8c07b7d78c7f3fb4c797a1da/src/index.ts#L101-L156)).
- The official MCP servers repo uses the same pattern for filesystem, sequential thinking, and memory ([source](https://github.com/modelcontextprotocol/servers/blob/acedea0c24b3e20d7265f87b8b2afe2e0c6eb2f4/src/filesystem/index.ts#L1-L20), [source](https://github.com/modelcontextprotocol/servers/blob/acedea0c24b3e20d7265f87b8b2afe2e0c6eb2f4/src/sequentialthinking/index.ts#L18-L26), [source](https://github.com/modelcontextprotocol/servers/blob/acedea0c24b3e20d7265f87b8b2afe2e0c6eb2f4/src/memory/index.ts#L1-L18)).

### Recommendation

Do not switch `sudo_bash` to a native opencode tool right now.
The current MCP shape matches the problem: one small, reusable, language-agnostic process that proxies a privileged HTTP endpoint.
Revisit only if we later want to collapse the extra process and accept the tighter coupling, or if opencode's native plugin boundary grows a better security / lifecycle story for privileged integrations.
