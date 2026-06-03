---
status: PENDING
commit: 
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-26T23:45:14-05:00
legacy_number: 112
---

# Templates redesign: Settings tab UX + new-session prepend-on-submit + per-project .vibekick/templates + slash command integration

User prompt (verbatim):

> New session has init templates. It works like shit.
>
> First, let's redo settings
>
> Settings
>
> Appearance
> Prompt
> Composer
> Chat
> Files
> Tools
> Content
> Notifications
> Performance
> Diagnostics
> Tools
> Tools appear in the topbar action menu. Disable any you don't want to see; edit a system tool's prompt to customise it (your edit survives future updates and you can hit Reset to restore the shipped version). Add your own prompt templates with the button at the bottom. Use the Init checkbox on any template to mark it as a project-init template.
>
> Project init template ordering
> Drag to reorder. When you create a new project, these templates are pre-checked in the create-project modal and concatenated in this order as the new session's first auto-prompt. <- always show to explain what init template is.
>
> Checkbox <- move from here...
> Pull
> Pull the latest changes from the remote repository.
>
> Checkbox Hamburger <- to here
> Checkbox INIT
>
> Edit
> ADD "Disable" button on stock tools. (no delete)
>
>
> Your custom tools
>
> + Add custom tool <- sticky during scrolling down
>
> git worktree -> main -> deploy -> push
> [Custom] <- badge is useful, the section is called custom tools, that's enough
> Edit
> Delete
>
> Also show per project/workspace tools section, create them here in UI, show what level they're created on (full path starting from workspace as it is defined, eg. path could be /home/nowaker /projekty/something but Since root workspace here is defined as ~/projekty then must show as such). When created on project/any directory level, crate it in filesystem in  .vibekick/templates/template-name.md. (openportal will be rebranding to vibekick, so we're already introducing its paths.)
>
> When creating a new session, only show this project's/directory's templates and all parents ..,../.. And so on, until workspace root.
>
> When showing settings, show all found in the workspace, recursively.
>
> Reordering should be inline - same list - not a separate list for configuration and separate for ordering.
>
> Ordering for filesystem based ones should be saved in yaml front matter of each template in MD file. (as should all fields).
>
> On session create, currently, when I disable "init" on a stock tool, it still shows on the new session list. It shouldn't. Show only init tools on session create.
>
> Another checkbox besides hamburger, init: slash. Total three. If enabled as slash command, it shows on the list of /slashcommands as "/template Full name here" on the list, and when activated, immediately replaces itself with that template's content + padding up to 2x \n before and after so proper spacing is added before/after content (if any). Only show templates active for a given project (not disabled), only. Current project, and all directories down to the workspace root.
>
>
> On new. Session create, when I check box enable an unit template, it shouldn't go to the prompt field. It should be prepended to prompt content on submit. Prompt history should remember it as:
> /template Full name 1
> /template full name 2
>
> User prompt here.

Design notes:

- Full analysis in `ai-analysis-requests/TEMPLATES_REDESIGN.md`. Companion docs: `NEW_SESSION_FLOW.md`, `SLASH_COMMANDS.md`.
- Implementation in 7 phases on `feat/templates-redesign` worktree (`~/projekty/webapps/portal-templates-redesign`):
  - **A**: bug fix - new-session picker filters disabled templates (1-line fix in `apps/web/src/routes/_app/session/new.tsx`).
  - **B**: `tools-store` extension - `slashCommandIds: string[]` slice + `toggleSlashCommand` mutator. Filesystem template support: new `kind: "fs"` branch in `ResolvedTool` carrying `location` (absolute path) + `scope` (path relative to workspace root).
  - **C**: filesystem loader `apps/web/src/server/lib/vibekick-templates.ts` + 3 API routes (GET workspace-recursive, GET dir-effective-stack, POST create/edit, DELETE). YAML frontmatter via `gray-matter`: `name`, `description`, `enabled`, `init`, `slash`, `order` + body. Scope-validated against `~/.openportal/openportal.json directories[].path`.
  - **D**: Settings UI redesign (`apps/web/src/components/tools-settings.tsx`). Drag handle LEFT of row, three inline checkboxes (enabled/init/slash), unified list (no separate ordering section), always-visible init explanation, Disable button on stock (no Delete), `[Custom]` badge removed, sticky `+ Add custom tool` footer. Per-project section with scope-path column + create-modal.
  - **E**: slash command integration. Extend slash-command-popover.tsx to handle `source: "template"` items. Both composers ($id.tsx and new.tsx) inject template-slash items into their `slashItems` filter list. On accept, replace the `/template-name` token with template body, padded to clean `\n\n…\n\n` boundary.
  - **F**: new-session submit + archive format. Stop auto-populating textarea with template content. On submit, build archive text as `/template Foo\n/template Bar\n\n<user prompt>`. Send EXPANDED text (each `/template …` -> body) to opencode. Two-layer split: archive sees readable references; opencode sees expanded bodies.
  - **G**: chat composer parity. Same injection in $id.tsx so mid-session `/template-name` works. Folds in side-fix: inject `/btw` (currently $id.tsx-only) into new.tsx too so the user's observation that "`/btw` doesn't show up on new-session" is closed.
- Deploy via `bash scripts/deploy.sh` after each major phase. Push to BOTH `origin` (gitlab) and `github` after each commit.
- `.vibekick/` is the canonical path because OpenPortal -> vibekick rebrand is queued; adopting now avoids a filesystem migration later.
- Side observation surfaced in the same prompt: `/btw` is invisible on new-session because the builtin-injection only exists in $id.tsx (chat composer), not new.tsx. Phase G closes both.
