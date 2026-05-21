# Slash commands - how they work, what they can do, how clients call them

Canonical reference for opencode's slash command system + how OpenPortal
integrates it. Written 2026-05-21 against opencode 1.15.6 / SDK v2.

## Server-side model

opencode owns the command catalog. The shape lives in
`~/projekty/webapps/opencode/packages/opencode/src/command/index.ts:29-41`:

```ts
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
})
```

Mirrored in the SDK at
`~/projekty/webapps/opencode/packages/sdk/js/src/v2/gen/types.gen.ts:1597`:

```ts
export type Command = {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: "command" | "mcp" | "skill"
  template: string         // SDK projects it as resolved string
  subtask?: boolean
  hints: Array<string>
}
```

Field meanings:

| Field | Meaning |
|---|---|
| `name` | Identifier used after the slash (`/<name>`). |
| `description` | One-line hint shown in pickers. |
| `agent` | Override the agent for THIS command's execution. |
| `model` | Override the model for THIS command's execution. |
| `source` | Where the command comes from: built-in / config (`"command"`), MCP prompt (`"mcp"`), skill (`"skill"`). |
| `template` | Prompt text. May contain `$1..$9` and `$ARGUMENTS` placeholders. |
| `subtask` | If true, opencode spawns the command as a subagent task rather than running inline. |
| `hints` | Pre-extracted list of placeholders the user can fill (auto-derived from the template via `hints()` helper at line 43). |

## Command sources

opencode's command service (`layer` at line 65) populates the catalog from
four independent sources, in priority order:

### 1. Built-in defaults

Two ship with opencode itself (lines 77-95):

- `init` - "guided AGENTS.md setup". Template
  `template/initialize.txt` with `${path}` substituted at lookup time.
- `review` - "review changes [commit|branch|pr], defaults to uncommitted".
  Template `template/review.txt`, marked `subtask: true` so it runs in a
  forked agent session.

These are hard-coded in `Command/index.ts`.

### 2. User config commands

`~/.config/opencode/config.json` (or the project-local override) under
`command.<name>` (lines 97-110). Each entry contributes:

```json
{
  "command": {
    "ship": {
      "agent": "build",
      "model": "anthropic/claude-opus-4-7",
      "description": "Build + deploy + commit",
      "template": "Run scripts/deploy.sh and commit any green changes",
      "subtask": false
    }
  }
}
```

opencode reads `cfg.command` at `Command.state()` init time and merges them
on top of the built-ins. Config entries can OVERRIDE built-ins (same `name`).

### 3. MCP prompts

Any MCP server connected to opencode that exposes a `prompts/list` capability
contributes one command per prompt (lines 112-130). The `template` is a lazy
`Promise<string>` resolved via `mcp.getPrompt(name)` at execution time -
allowing the MCP server to dynamically generate prompt content per invocation.
Source is stamped `"mcp"`.

### 4. Skills

opencode skills (`~/.opencode/skills/<name>/SKILL.md` or analogous) each
register a command. Skills can ship parameterised templates plus reference
files, scripts, etc. Source `"skill"`.

## Template substitution

The `hints()` helper at line 43 scans the template for two placeholder
shapes:

- `$N` (where N is a digit) - positional placeholder, e.g. `$1`, `$2`.
- `$ARGUMENTS` - the entire user-supplied argument string.

Hints are pre-computed at catalog build time and returned in the `Command`
shape, letting clients render argument-hint UI without re-parsing the
template.

Substitution itself happens server-side at execution time. The client
sends the raw command name + args; opencode walks the template,
replacing placeholders with the user's args.

## Command lifecycle

The client side is straightforward; the server does the heavy lifting.

1. **Discovery** (client lists commands):
   - Client: `GET /command` -> array of `Command`. In OpenPortal this is
     `useCommands()` at
     `apps/web/src/components/slash-command-popover.tsx:21`, calling
     `GET /api/opencode/<port>/command`.
   - Server side this calls `Command.Service.list()` from
     `command/index.ts:60`.

2. **User types `/foo bar baz` in the composer**:
   - Client detects the leading slash + name (popover at
     `slash-command-popover.tsx:441` matches `^/(\w+)`).
   - Client EITHER renders an autocomplete picker (filtered by name +
     description) OR routes through a slash-sub-picker mode for
     `/agent <name>` and `/model <name>` (which manipulate the SUBMIT
     metadata, not opencode's command catalog).

3. **User accepts the slash command**:
   - Client submits the user prompt as USER MESSAGE (just like any other
     prompt) with the leading `/foo bar baz` text intact. opencode's
     prompt pipeline detects the slash prefix server-side and resolves the
     command from the catalog.
   - opencode substitutes `$ARGUMENTS` / `$1..$9` with the user args, then
     replaces the user message with the resolved template + executes
     normally. The `command.executed` BusEvent (line 17) fires for
     observability.

4. **Special path: `subtask: true`**:
   - opencode forks a NEW SESSION using the command's `agent` (defaulting
     to the configured subagent) and runs the resolved template in that
     fork. The parent session sees a task tool call. The fork session
     reports back via the task result.

So:
- **Discovery** is server-side, exposed via SDK.
- **Substitution** is server-side, opaque to the client.
- **Argument hints** are pre-extracted server-side and shipped to the
  client so it can render `$1 / $2 / $ARGUMENTS` hint chrome.

## HTTP API surface

The SDK v2 type at
`packages/sdk/js/src/v2/gen/types.gen.ts:4580-4597` confirms only `list`:

```ts
export type CommandListData = {
  body?: never
  path?: never
  query?: never
  url: "/command"
}

export type CommandListResponses = {
  200: Array<Command>
}
```

There is no `command.run` SDK method - the client invokes a command by
submitting it as a regular user prompt prefixed with `/<name>`. The
server-side prompt pipeline does the slash-detection + substitution.

## OpenPortal client integration

OpenPortal's slash UX has three modes
(`apps/web/src/components/slash-command-popover.tsx:144`):

```ts
export type SlashMode = "command" | "agent" | "model"
```

- `command` - default. Fetches via `useCommands()` ->
  `/api/opencode/<port>/command`. Items rendered with their `source`
  badge (`(mcp)`, `(skill)`, `(agent)`, etc., line 247-252).
- `agent` - triggered by `/agent <q>`. Popover items are AGENTS, not
  commands - selecting an agent applies it as an inline agent override
  on the next submit only. This is an OpenPortal-side affordance, NOT a
  built-in opencode command.
- `model` - same as `agent`, for `/model <q>`. Inline model override.

Slash detection in OpenPortal lives in `useSlashCommand()`
(line 413). It detects:

- Leading slash at the very start of the textarea
- ALSO leading slash at the start of line 1 even if subsequent lines
  contain content (shipped in commit `59475c8`)
- Sub-picker patterns `^/agent\s+\S*$` and `^/model\s+\S*$` switch
  `mode` to `agent` or `model`

Custom items (when `mode !== "command"`) are passed by the caller via
the `customItems` prop. Otherwise the popover renders the server's
`/command` list as-is.

### OpenPortal-side `/btw` (commit 73af990)

`/btw <question>` is intercepted in `handleSubmit()` at
`apps/web/src/routes/_app/session/$id.tsx:4148`. The composer rewrites
the message text to wrap the question in a system-prompt-style hint
("[BTW: side question - answer briefly in ONE response, do not call any
tools, do not promise follow-up actions]") before submitting through
the normal prompt path. The synthetic `btw` entry is INJECTED into the
slashItems memo at line 3473 alongside opencode's real commands.

This is an OpenPortal-side trick - opencode never sees `/btw` as a
command in its catalog. The client expands the text BEFORE submitting.

## How a non-TUI client integrates

For a new client building on opencode:

1. Call `GET /command` once on session start (cache it).
2. Re-fetch when:
   - User connects a new MCP server (would emit a `command.added`
     event in newer opencode, otherwise on focus / periodic).
   - Config file changes (file watcher).
3. Render a slash picker keyed on `name` + `description` + `source`.
4. Show `hints[]` as argument-hint chrome so the user knows what
   `$1 $2 $ARGUMENTS` map to.
5. Submit the raw `/<name> <args>` text as a normal user prompt.
   Server-side substitution + execution is automatic.

Edge cases worth handling:

- `subtask: true` commands - the chat will show a task tool call
  instead of an inline response. Render it as such.
- MCP-sourced commands can have lazy templates - the SDK projects
  `template` as `string`, but server-side resolution is async. Don't
  assume the template you see in the list response is stable
  across MCP reconnects.
- `agent` / `model` overrides on a command apply to THAT TURN ONLY -
  the next user message reverts to the session's default agent/model.
- Hints can contain duplicates if the template uses the same
  placeholder multiple times - opencode dedupes via `new Set()` at
  line 47, but be defensive.

## Example responses

`GET /api/opencode/<port>/command` on a typical setup:

```json
[
  { "name": "init", "description": "guided AGENTS.md setup",
    "source": "command", "template": "...", "hints": [] },
  { "name": "review",
    "description": "review changes [commit|branch|pr], defaults to uncommitted",
    "source": "command", "subtask": true,
    "template": "...", "hints": ["$ARGUMENTS"] },
  { "name": "deploy", "agent": "build",
    "model": "anthropic/claude-opus-4-7",
    "description": "Build + deploy + commit",
    "source": "command", "template": "Run scripts/deploy.sh and commit",
    "hints": [] },
  { "name": "summarize", "source": "mcp",
    "description": "Summarize this conversation",
    "template": "(lazy promise resolved at exec time)", "hints": [] }
]
```

## Where to look in code

| Concern | Path |
|---|---|
| Command type (Effect schema) | `~/projekty/webapps/opencode/packages/opencode/src/command/index.ts:29-41` |
| Command type (SDK v2) | `~/projekty/webapps/opencode/packages/sdk/js/src/v2/gen/types.gen.ts:1597` |
| Hints extraction | `~/projekty/webapps/opencode/packages/opencode/src/command/index.ts:43-51` |
| Built-in `init` + `review` | `~/projekty/webapps/opencode/packages/opencode/src/command/index.ts:53-95` |
| Config-sourced merge | lines 97-110 |
| MCP-sourced merge | lines 112-130 |
| Skill-sourced merge | further in the file |
| OpenPortal SWR cache | `~/projekty/webapps/portal/apps/web/src/components/slash-command-popover.tsx:21` |
| OpenPortal slash detection | same file, line 413 (`useSlashCommand`) |
| OpenPortal /btw extension | `~/projekty/webapps/portal/apps/web/src/routes/_app/session/$id.tsx:4148` |

## Closing notes

The slash command pipeline is deliberately thin: opencode owns the
catalog + execution; clients are pure render + submit. The substitution
+ command-resolution machinery is server-side, meaning a web/mobile
client only needs `GET /command` + the usual prompt-submit endpoint -
it does NOT need a separate "run command" verb.

For OpenPortal specifically, the `/btw` synthetic command is the
template for adding more client-side-only commands without polluting
opencode's catalog. The same pattern would work for `/quote`, `/focus`,
or any other openportal-only UX shortcut: intercept in handleSubmit,
inject into slashItems for discovery.

The 3-mode picker (command / agent / model) is OpenPortal-specific.
Other clients might want a single uniform picker that surfaces agents
and models through a different mechanism. opencode's catalog is the
neutral primitive; how clients dress it is up to them.
