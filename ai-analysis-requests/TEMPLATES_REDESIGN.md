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

## Round 4 (2026-05-30) — synthesis after live bug + rename mandate

User opened a fresh analyze-mode round combining several refinements
across multiple turns. The deliverable is this section + AI_TODO #142;
no code changes shipped in this round. Four parallel explore agents
(bg_16dfa57d settings-tab, bg_f38e5ad5 new-session-flow,
bg_88a7376f data-model+fs, bg_51ff549e slash-autocomplete) produced
supporting analysis docs in `ai-analysis-requests/`
(`TOOLS_SETTINGS_INVENTORY.md`, `NEW_SESSION_FLOW.md`,
`TEMPLATES_DATA_MODEL_SCHEMA.md`,
`COMPOSER_SLASH_AUTOCOMPLETE_WIRING.md`).

### Live bug on `main-nowaker` (must fix first)

A partial merge from `feat/templates-redesign` to `main-nowaker` left
`tools-settings.tsx` ReferenceErroring at runtime:

| Site | Line | Defect |
|---|---|---|
| `ToolsSettings()` body | 748 | `<UnifiedToolList tools={tools} />` — component not defined or imported |
| `FsTemplatesSection()` body | 681 | `<FsTemplateRow … />` — not defined |
| `FsTemplatesSection()` body | 697 | `<NewFsTemplateForm … />` — not defined |
| `AddCustomTool()` body | 528-544 | `burger`, `setBurger`, `init`, `setInit`, `slash`, `setSlash` referenced without `useState` declarations |
| `AddCustomTool()` body | 548-561 | `error`, `saving`, `onClose`, `submit` referenced but not defined |

User sees `ReferenceError: UnifiedToolList is not defined` on
`/settings#templates` (asset `settings-CP94QAF_.js`). Fix lands in
Phase D — implementing UnifiedToolList + FsTemplateRow +
NewFsTemplateForm + completing AddCustomTool state together rather
than hot-patching broken code in place. NO partial component is
committed before its consumers are wired.

### Design reversal — init-only filter on new-session picker

User's Round 4 prompt:

> On session create, currently, when I disable "init" on a stock tool,
> it still shows on the new session list. It shouldn't. Show only
> init tools on session create.

This **reaffirms Phase A** of this document and **reverses** the
decision recorded in AI_TODO #126 / #127 ("show all non-disabled,
init pre-checked"). Authoritative behaviour as of Round 4:

- **New-session picker** renders ONLY templates with `init: true && !isDisabled`. Non-init templates do not appear at all.
- All shown rows are checked by default (since they're all init-flagged).
- Per-row uncheck + drag reorder still works.

**Slash autocomplete** keeps its independent visibility rule:
templates with `slash: true && !isDisabled`, additionally filtered
for filesystem templates by current-or-ancestor directory scope
relative to the active session's directory. Init flag is irrelevant
to slash visibility.

A future agent that re-reads this doc should NOT silently flip back
to "show all non-disabled" — that was a transient decision in
Rounds 2/3 that the user has now retracted.

### Rename mandate — Tools → Templates

User's Round 4 prompt:

> they are no longer tools. we call them templates. anywhere they are
> mentioned, ui or code (including class names), must refer to as
> templates.

Scope:

| Surface | Rename | Notes |
|---|---|---|
| UI labels (Settings tab, buttons, copy, tooltips) | yes | `Tools` → `Templates`, `+ Add custom tool` → `+ Add custom template`, "Your custom tools" → "Your custom templates", etc. |
| Component names (`ToolsSettings`, `SystemToolRow`, `CustomToolRow`, `AddCustomTool`, `useResolvedTools`, etc.) | yes | Symbol renames + matching file renames |
| File names (`tools-settings.tsx`, `tools-store.ts`, `prompt-tools.ts`) | yes | → `templates-settings.tsx`, `templates-store.ts`, `prompt-templates.ts` |
| Type names (`SystemTool`, `CustomTool`, `ResolvedTool`, `FsTemplate`) | partial | `SystemTemplate`, `CustomTemplate`, `ResolvedTemplate`; `FsTemplate` already correctly named |
| API routes | already done | `/api/vibekick-templates` already correctly named; no `/api/tools` route exists |
| Settings tab id / hash | already done | `#templates` tab id already in code; `#tools` hash redirects |
| **localStorage key `"opencode-tools"`** | **NO** | Keep stable to preserve existing user data. Renaming silently wipes every user's custom templates + init order. A code comment at the persist key declaration explains why. |
| **Stock template ids** (`git.pull`, `git.push`, `git.create-pr`) | **NO** | Persisted by id in `disabledIds` / `projectInitOrder` / `slashCommandIds` arrays. Renaming = the user's "I disabled Pull" turns into "Pull is now visible again". |

The rename is a separate phase from the bug fix; bug fix lands first
so the broken tab is rendered immediately, rename pass lands on top
of the working code.

### FS template polish (folded in from AI_TODO #127)

These four bumps land as part of Phase D and Phase E:

1. **Edit FS templates.** `FsTemplateRow` gains an Edit button + inline
   form pre-filled with the row's current name / description / burger
   / init / slash / order / prompt. Submit overwrites the same `.md`
   file; location is locked (move = Delete + New).
2. **Graceful refresh.** `useAllFsTemplates` and
   `useFsTemplatesForDirectory` switch to SWR `keepPreviousData: true`.
   Section header shows `<Loader className="size-3" />` +
   "Rescanning files…" pill while `isValidating && data` is truthy.
   The row list never unmounts during revalidation; checkbox flips
   no longer cause the visible list to blink empty.
3. **Duplicate.** Every Custom + FS row exposes a Duplicate button.
   Opens the create form pre-filled with the source row's fields
   (workspace pre-selected, sub-path inherited but editable,
   name/description/prompt/flags copied). User edits + saves; lands
   as a new template at the chosen location, source row untouched.
4. **Flags at create.** `NewFsTemplateForm` surfaces three
   FlagCheckboxes (Burger / Init / Slash) inline. Same component
   the rows use. `AddCustomTool` gains the same three checkboxes
   (the JSX is already drawn at tools-settings.tsx:528-544 — it
   just lacks `useState` declarations + a `submit` handler; both
   complete in Phase D).

**Form refactor**: instead of three near-duplicate components
(`NewFsTemplateForm` / `EditFsTemplateForm` / `DuplicateFsTemplateForm`),
parameterise as one `FsTemplateForm` with three modes:

- `mode: "new"` — empty fields; workspace = first; flags default
  (burger:true, init:false, slash:false); button "Create".
- `mode: "duplicate", source` — workspace + sub-path + fields +
  flags copied from `source`; button "Create copy".
- `mode: "edit", target` — workspace + sub-path locked (read-only
  display); fields + flags copied from `target`; button "Save"
  rewrites `target.location`.

### Prompt archive distinction (clarification, no change to code)

User Round 4 clarification:

> i meant prompt history, feature of openportal. NOT the chat log
> opencode has. there, the AI must see the ENTIRE template. if it
> gets /template, it doesn't know shit about it.

Current implementation per `NEW_SESSION_FLOW.md` already does the
right thing:

| Channel | Sees | Why |
|---|---|---|
| OpenPortal prompt archive (`prompts.raw_text`) | `/template Full name 1\n/template Full name 2\n\nUser prompt here.` | Scannable history surface |
| opencode chat log (`prompt_async` `parts[].text`) | `<Foo body>\n\n<Bar body>\n\nUser prompt here.` | The AI gets full instructions |

Implementation lives at `new.tsx` submit handler: builds two parallel
strings (`archivePrefix` compact, `opencodePrefix` expanded), posts
to `/api/opencode/{port}/session/{id}/prompt` with `text` (expanded)
and `archiveText` (compact). Re-firing an archived row re-runs the
expansion pass against the user's CURRENT templates (the archive
stores names, not bodies — body edits are picked up on refire, not
frozen at archive time).

### Round 4 implementation order (when authorized)

The user has NOT yet authorized implementation. When they do, ship
in this order on a fresh `feat/templates-redesign-round-4` worktree
(the existing partial merge on `main-nowaker` is the bug surface;
work happens in a worktree to keep diffs reviewable):

1. **Bug fix (atomic).** Implement `UnifiedToolList`, `FsTemplateRow`,
   `NewFsTemplateForm`; complete `AddCustomTool` state +
   `submit`. Verify `/settings#templates` renders. Deploy + push.
2. **Init-only filter on new.tsx picker** (Phase A reaffirmed).
   Filter `t.init === true && !t.isDisabled`. Solo commit.
3. **Tools → Templates rename pass.** Symbol + file + label + type
   renames per scope table above. localStorage key + stock ids
   stay stable with explanatory comments. Solo commit.
4. **FS template polish.** Edit + Duplicate + flags-at-create +
   graceful refresh. Combine into one `FsTemplateForm` per the
   refactor above.
5. **Slash command integration** (Phase E + Phase G) including
   `/btw` parity on new.tsx composer.
6. Build + deploy via `scripts/deploy.sh` between each phase.
   Browser-verify each phase.
7. Push to `origin` (GitLab canonical) + `github` (mirror) after
   each phase lands cleanly.

## Round 5 (2026-05-30) — prompt format pivot + collapsible templates

While Round 4 was in implementation the user described a new prompt
format and a new render strategy. The Round 4 archive vs opencode
split goes away; both surfaces now store/receive the same expanded
text. The frontend layer collapses it into OMO-style pills.

### Wire format (what opencode receives + what archive stores)

```
<user prompt>

---

User has explicitly requested these extra rules to apply in this very session - obey diligently:

# /template "<Title 1>":

<body 1>

# /template "<Title 2>":

<body 2>
```

Properties:
- User prompt comes FIRST. Templates are appended below as
  user-mandated rules - reframes "did the AI follow the templates?"
  as a compliance check rather than a free-form instruction.
- `---` separator + the preamble paragraph form the marker the
  frontend collapse logic looks for.
- Each block is headed by `# /template "Title":` (double-quoted
  title, trailing colon, blank line before the body). Double-quotes
  inside titles escape with `\"` so the parser regex doesn't get
  confused.
- Bodies preserve newlines verbatim; blocks are separated by a blank
  line.

When no templates are checked, the wire text is just the user's
prompt verbatim - no separator, no preamble.

### Single-source-of-truth text (no more archive/opencode split)

Previously `new.tsx` built TWO strings:
- `archiveText = "/template Foo\n/template Bar\n\nUser text"` (compact)
- `opencodeText = "<foo body>\n\n<bar body>\n\nUser text"` (expanded)

POSTed both to `/api/opencode/.../prompt` which stored archiveText
in SQLite and forwarded opencodeText to opencode. The frontend then
rendered TWO different things to the user during the prompt
lifecycle - the compact form during the "Submitted to OpenCode"
phase and the expanded form once opencode echoed back a
`message.updated` event. The user reported this as confusing
("two different texts in flight, neither is what i actually want").

Round 5: both equal the wire format above. `new.tsx` builds one
`opencodeText`, sets `archiveText = opencodeText`, and the existing
`body.archiveText ?? body.text` fallback on the server stores the
identical string. The new `apps/web/src/lib/prompt-template-format.ts`
module exposes `buildPromptWithTemplates(userText, templates)` for
the producer side and `parsePromptWithTemplates(text)` for the
frontend collapse renderer.

### Frontend collapse (render-time, no wire change)

`parsePromptWithTemplates(text)` returns
`{ userText, templates: [{ name, body }] } | null`. Renderers
detect the marker and replace the templates appendix with one pill
per block, OMO-style:

```
<user prompt>
[ Template: <Title 1>  [+] ]
[ Template: <Title 2>  [+] ]
```

- Pill component matches the visual style of `OmoBlockView`
  (border, muted bg, +/- icon, expandable region) with a distinct
  visual cue (e.g. accent-bordered border-l) so the user can tell
  template blocks apart from OMO directives at a glance.
- The FIRST pill's expanded body ALSO includes the `---` separator
  + preamble paragraph - those belong conceptually to the first
  block's introduction. Subsequent pills only show their own body.
- Per-pill open/closed state lives in the renderer; no cross-tab
  sync.

### Surfaces that render the new format

| Surface | File | Behaviour |
|---|---|---|
| Chat message body (user message) | message renderer (TBD - locate next) | Detect via `parsePromptWithTemplates`; render userText as normal markdown + pill list below |
| Prompt history row preview | `apps/web/src/routes/_app/prompts.tsx` | Detect + show userText + pill list (collapsed by default) |
| Prompt history full-view | same | Same parse + pill rendering |
| Composer preview (new-session) | `new.tsx` | Pre-submit visual confirmation - already correct per Round 4 |

Old-format messages (compact `/template Foo` archive rows, or any
plain text) render unchanged - `parsePromptWithTemplates` returns
null for them and the renderer falls back to its normal path.

### Round 5 implementation phases

| Phase | Change | Status |
|---|---|---|
| R5-A | `prompt-template-format.ts` + tests | DONE this commit |
| R5-B | new.tsx submit handler emits the new format | DONE this commit |
| R5-C | Collapse component + chat-log renderer integration | PENDING |
| R5-D | Prompt history renderer | PENDING |

### Anti-reversion notes

- DO NOT route `archiveText` separately from `text` for templates -
  the whole point of Round 5 is that they're the same.
- DO NOT shorten the preamble paragraph - the exact string is the
  parser's anchor. If a future reword is needed, update
  `PROMPT_TEMPLATE_PREAMBLE` AND scan existing archive rows to
  rewrite the old preamble (or accept both during a deprecation
  window).
- DO NOT change the `# /template "Title":` block header shape -
  same parser-anchor reason.
