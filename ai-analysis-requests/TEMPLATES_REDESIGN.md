# Templates redesign — Settings/Tools tab, new-session UX, slash commands, per-project templates

Living document tracking the templates / tools redesign requested via
the new-session-templates audit conversation. Companion to
`NEW_SESSION_FLOW.md` (which maps the pre-redesign flow) and
`SLASH_COMMANDS.md` (which maps the pre-existing slash-command stack).

## Scope (verbatim from user)

The user wants four coupled changes shipped together:

1. **Settings → Tools tab redesign.** Drag handle moves to the LEFT
   of each row. Three checkboxes per template: enabled, init, slash.
   Stock tools get a "Disable" button (no delete). Custom-tool rows
   lose the `[Custom]` badge (the section header carries that). The
   "+ Add custom tool" button stays sticky as the list scrolls. The
   project-init ordering explanation is ALWAYS visible. Ordering
   happens inline in the same list (no separate ordering panel).

2. **New-session bug fix + UX change.** The picker currently shows
   every template (even ones the user has disabled in Settings). It
   must filter to enabled+init templates only. Checking a template
   in the picker MUST NOT splice its body into the visible textarea;
   the body is prepended on submit. The prompt archive records the
   submission as:

   ```
   /template Full name 1
   /template full name 2

   User prompt here.
   ```

3. **Per-project / per-workspace templates.** A new section in
   Settings → Tools lists templates stored on disk at
   `<dir>/.vibekick/templates/<slug>.md`. Each template carries YAML
   frontmatter for all metadata (name, description, enabled, init,
   slash, order) and the prompt body as the markdown body. `<dir>`
   may be the workspace root OR any subdirectory; templates inherit
   downward (a template at `~/projekty/.vibekick/templates/foo.md`
   is visible to every project under `~/projekty/*`).

   - Settings shows the FULL recursive tree from each workspace root
     downward, with each template's scope (path relative to its
     workspace root) shown next to it.
   - New-session shows only the effective stack for the chosen
     project: templates in that project's `.vibekick/templates/` PLUS
     templates in every parent directory up to and including the
     workspace root.

   `.vibekick/` is the canonical path because OpenPortal is being
   renamed to "vibekick"; we adopt the new directory now so the
   filesystem isn't rebranded later.

4. **Slash command integration.** A `slash` checkbox per template
   registers it as a slash command. Typing `/template-name` in any
   composer shows it in the existing `/slashcommands` autocomplete
   list as `/template Full name here`. Accepting the suggestion
   replaces the `/template-name` token with the template body, padded
   to a clean `\n\n…\n\n` boundary so spacing around it is sane
   regardless of where the user inserted it. Only templates active
   for the current project (not disabled, in scope) appear.

## Side observation: `/btw` is invisible on the new-session page

The user reported "I type `/btw` into the prompt field as the first
thing, and nothing shows up on the slash commands list." Root cause:
`/btw` is a synthetic OpenPortal-side command injected into the
chat composer's `slashItems` memo at
`apps/web/src/routes/_app/session/$id.tsx:4242-4248`, but the
new-session composer at
`apps/web/src/routes/_app/session/new.tsx:209-213` filters
`commandsData` from opencode directly — no `builtin` injection.

The same pattern that fixes the new template-slash feature
(injecting client-side synthetic entries into the new-session
slash list) is what fixes `/btw` parity. We fix both in the same
commit that lands template-slash on the new-session composer.

## Current architecture (pre-change snapshot)

### Persistence

- **localStorage `opencode-tools`** (`apps/web/src/stores/tools-store.ts`):
  - `disabledIds: string[]` — tool ids the user unchecked.
  - `systemOverrides: Record<string, { name?, prompt? }>` — per-stock-tool name/prompt overrides.
  - `customTools: CustomTool[]` — user-defined tools (`id`, `name`, `description?`, `prompt`).
  - `projectInitOrder: string[]` — ordered list of init-marked tool ids.
- **System tools** (`apps/web/src/lib/prompt-tools.ts`): three hardcoded entries — `git.pull`, `git.push`, `git.create-pr`.
- **No server-side persistence yet.** Tool state is per-device localStorage only.

### UI

- **Settings → Tools** (`apps/web/src/components/tools-settings.tsx`, 529 lines):
  - Intro paragraph.
  - `ProjectInitOrderingSection` — separate drag-reorder list, hides when empty.
  - System tool rows: `[checkbox] [name+desc] [Init checkbox] [Edit] [Reset?]`.
  - Custom tool rows: same shape + `[Custom]` badge + Delete instead of Reset.
  - `AddCustomTool` — inline expand-to-create form.

- **New-session picker** (`apps/web/src/routes/_app/session/new.tsx`):
  - Lines 712-762: renders ALL `resolvedTools` (the bug — disabled ones included).
  - Lines 172-176: `composedAutoPrompt` joins checked templates with `\n\n---\n\n` separator.
  - Submit handler (lines 325-486): the textarea (containing concatenated templates + user text) is posted as one blob to `/api/opencode/{port}/session/{id}/prompt`.

- **Slash command popover** (`apps/web/src/components/slash-command-popover.tsx`, 529 lines):
  - Hook `useSlashCommand()` manages detection, search query, caret-positioned popover.
  - Three modes: `command`, `agent`, `model`.
  - Used by both chat composer ($id.tsx) and new-session composer (new.tsx).

- **Chat composer slash items** ($id.tsx:4242-4252): merges a `builtin` array (currently only `btw`) with the opencode `commandsData` and filters by `startsWith(query)`.

- **New-session composer slash items** (new.tsx:209-213): filters `commandsData` only. No `builtin`. No `btw`.

### Archive

- **`apps/web/src/server/lib/prompt-archive.ts`**: each prompt is one `PromptRow` with `raw_text`, `source` (`"prompt"` or `"command"`), and optional `command_name` / `command_arguments` when sourced from a slash command. Currently a template-prepended prompt is stored as a single `"prompt"` row with the merged text.

## Redesign — phases and commits

Implementation lands in atomic commits. Each phase builds on the
previous; deploy + verify between phases.

### Phase A (bug fix): filter disabled templates on new-session

Smallest viable change. `new.tsx` filters checked-INIT templates to
`enabled && projectInitOrder.includes(id)`. No schema changes; no
new components. Solo commit so the bug fix is reviewable in
isolation if the rest needs to roll back.

### Phase B: extend tools store

Adds two new persisted slices to `tools-store.ts`:

- `slashCommandIds: string[]` — ids of tools enabled as slash
  commands. Mirrors `disabledIds` shape (set semantics; order not
  meaningful).
- `toggleSlashCommand(id, enabled)` — mutator.

Plus filesystem-source tool support (next phase) requires the store
to merge stock/custom/filesystem sources into a single `ResolvedTool`
union. Add a `kind: "fs"` branch with `location: string` (absolute
path of the source .md file) and `scope: string` (path relative to
the workspace root) carried through the resolver.

The `slug`-on-id convention: filesystem tools get an id derived from
their absolute path, e.g. `fs:/home/nowaker/projekty/webapps/portal/.vibekick/templates/git-worktree-main-deploy-push.md`.
Using the full absolute path as the id means two templates with the
same slug in different parents do not collide.

### Phase C: filesystem template loader

New module `apps/web/src/server/lib/vibekick-templates.ts`:

- `scanWorkspaceTemplates(workspaceRoot: string): Promise<FsTemplate[]>`
  recursively scans `<workspaceRoot>/**/.vibekick/templates/*.md`,
  parses YAML frontmatter via `gray-matter`, returns typed records.
- `templatesForDirectory(directory: string): Promise<FsTemplate[]>`
  resolves the workspace root (longest match against the openportal
  `directories[].path` config), then walks UPWARD from `directory` to
  workspace root collecting `.vibekick/templates/*.md` along the
  way. Returns templates in "closest-to-leaf first" order; settings
  UI can re-sort by the YAML `order` field.
- `writeTemplate(path: string, fields: FsTemplateInput): Promise<void>`
  serializes back to disk with `matter.stringify()`.
- `deleteTemplate(path: string): Promise<void>` for the delete action.

YAML frontmatter schema (matches user spec — all fields, including
order, live in the YAML):

```yaml
---
name: "git worktree -> main -> deploy -> push"
description: "Short description shown under the name."
enabled: true   # default true if missing
init: true      # default false if missing
slash: false    # default false if missing
order: 10       # integer; templates ordered ascending; ties broken by path
---
prompt body goes here
```

Two new API routes wire it to the client:

- `GET /api/vibekick-templates?workspace=<path>` — settings view; recursive scan.
- `GET /api/vibekick-templates?directory=<path>` — new-session view; effective stack for that directory.
- `POST /api/vibekick-templates` — create/edit; body carries path + fields.
- `DELETE /api/vibekick-templates?path=<path>` — delete a template file.

All paths are validated against the `directories[].path` allow-list
to prevent settings-UI input from writing outside workspace roots.

### Phase D: Settings UI redesign

Full rewrite of `tools-settings.tsx`:

- **Row layout** (uniform across stock, custom, filesystem):
  ```
  [drag handle] [enabled] [init] [slash] [icon] Name — description    [Edit] [Disable/Reset/Delete] [scope]
  ```
- **Drag handle on LEFT.** Drag-reorder mutates whichever order list
  applies to the row's source:
  - Stock + custom: relative order in the unified list; persisted in tools-store as a new `unifiedOrder: string[]`.
  - Filesystem: `order` field rewritten in YAML frontmatter on every drop.
- **Three checkboxes inline**, no separate ordering section:
  - `[ ] Enabled` — toggles disabledIds membership.
  - `[ ] Init` — toggles projectInitOrder membership.
  - `[ ] Slash` — toggles slashCommandIds membership (new).
- **Always-show init explanation.** The "Project init template
  ordering" paragraph moves to a permanent intro block above the
  unified list, not gated on having any init-marked items.
- **Stock tool actions**: `[Edit] [Disable]` (no Delete). "Disable"
  just calls `setEnabled(id, false)` — same as unchecking the
  enabled checkbox; surfaced as a button because that's what the
  user explicitly asked for. Reset only shows when overridden.
- **Custom tool actions**: `[Edit] [Delete]`. The `[Custom]` badge
  is removed.
- **Per-project section**: a header introducing filesystem templates,
  followed by their rows. Each row shows the scope (path relative to
  workspace root, e.g. `webapps/portal/.vibekick/templates/`) on the
  right edge. A "+ New project template" button per workspace root
  opens a modal that asks for slug + name + description + body and
  POSTs to the create endpoint.
- **Sticky "+ Add custom tool" button**. The button (and its
  expanded form when open) sits in a `sticky bottom-0` footer of
  the scroll container so it remains reachable as the user scrolls
  through a long template list.

### Phase E: slash command integration

Two changes:

1. **Inject template-slash items into both composers' slash lists.**
   - $id.tsx: extend the `slashItems` memo at line 4242 — push entries
     for every `slashCommandIds`-active resolved tool. Filter by
     project scope (current session.directory must be the project or
     within its workspace subtree for filesystem templates; stock +
     custom are always in scope).
   - new.tsx: extend the `filteredCommands` memo at line 209 — same
     injection (and the same fix gives `/btw` parity for free).
   - Item shape: `{ name: "template-name", description: "Full name here", source: "template" as const, _templateBody: string }`.
   - Display in popover: `/template Full name here` (the popover already renders `name` + `description`; we just feed it those strings).

2. **Expand template body on accept.**
   - The popover's `handleSelect` (slash-command-popover.tsx:499) currently writes the chosen `/name ` string back into the textarea. Add a `source === "template"` branch that splices the `_templateBody` (instead of the literal `/name`) and pads to `\n\n<body>\n\n` boundaries.
   - This expansion happens BEFORE submit, so the textarea visibly contains the expanded text — keystroke-accurate WYSIWYG.

### Phase F: new-session submit + archive

The user's spec for archive format:

```
/template Full name 1
/template full name 2

User prompt here.
```

The archive layer (`prompt-archive.ts`) stays the same — we just
change WHAT we archive. The new-session submit handler:

1. Filters checked init templates (already done in Phase A) so we know
   which templates the user accepted via the picker.
2. Builds `templatePrefix = checked.map(t => "/template " + t.name).join("\n")`.
3. Builds the message text as `templatePrefix + "\n\n" + composerText`.
4. Archives THAT text (not a per-template-row split). The archive
   sees the literal `/template Full name` lines + a blank line + the
   user's prompt. Search-by-text on the archive then matches both
   the template names AND the user prose.
5. Sends the EXPANDED message (with each `/template …` replaced by
   the template body) to opencode as the first prompt — the archive
   stores the human-readable preface, opencode gets the full prompt.

Two layers of expansion:

| Layer | Sees | Why |
|---|---|---|
| Archive (SQLite) | `/template Foo\n/template Bar\n\nUser text` | Readable history, scannable, refire-able |
| OpenCode (prompt) | `<Foo body>\n\n<Bar body>\n\nUser text` | Model gets the actual instructions |

This split is fine because the archive's existing "refire" action
re-invokes the same path: when the user clicks refire on the archived
prompt, openportal re-runs the template-expansion pass and ships the
expanded body to opencode. The user sees `/template …` lines in the
archive; opencode sees the expanded bodies.

### Phase G: chat composer parity

Identical injection + expansion logic landed in $id.tsx so typing
`/template-name` mid-chat in an existing session produces the same
behaviour as the new-session picker. This phase also lands the
`/btw` injection into new.tsx so the side-observation is closed.

## Open questions / deferrals

- **localStorage vs server-side persistence for the new
  `slashCommandIds` slice.** The existing tools-store is localStorage
  only. We could migrate the whole tools-store to
  `~/.openportal-state.json` under `settings.tools` (the same way
  `settings.autoApprove` lives), gaining cross-device sync. Out of
  scope for this redesign; if needed, do as a follow-up.

- **YAML frontmatter validation.** We do best-effort parsing via
  gray-matter with a fallback sanitizer (lifted from opencode's
  `config/markdown.ts`). Malformed YAML returns a typed error row
  rendered in red in the settings UI so the user knows which file
  broke without losing the rest.

- **File-system watch.** Initial implementation re-scans on every
  GET. A `chokidar` watcher could push changes via SSE later; not
  required for the MVP.

- **Slash command + opencode catalog collision.** If a user names a
  template `init` (collides with opencode's built-in `init`), the
  popover lists both. We could de-dupe by source priority (opencode
  catalog wins) or by silently renaming the template entry to
  `template-init`. Decision deferred — current behaviour is "both
  appear; the user picks one"; acceptable for the MVP.

## Files touched

- `apps/web/src/stores/tools-store.ts` (B, D)
- `apps/web/src/lib/prompt-tools.ts` (D)
- `apps/web/src/components/tools-settings.tsx` (D)
- `apps/web/src/server/lib/vibekick-templates.ts` (C, new)
- `apps/web/src/server/api/vibekick-templates/*.ts` (C, new)
- `apps/web/src/routes/_app/session/new.tsx` (A, F, G)
- `apps/web/src/routes/_app/session/$id.tsx` (E, G)
- `apps/web/src/components/slash-command-popover.tsx` (E)
- `apps/web/src/components/folder-browser.tsx` (D — may need scope adjustment)
- `apps/web/src/hooks/use-vibekick-templates.ts` (C, new — SWR hook)

## Cross-references

- `NEW_SESSION_FLOW.md` — pre-redesign new-session flow map.
- `SLASH_COMMANDS.md` — opencode's slash command stack +
  OpenPortal's existing integration (incl. `/btw` synthetic command).
- AI_TODO #112 — the durable queue entry for this work.
