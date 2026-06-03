---
status: PENDING
commit: 
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-26T23:45:14-05:00
legacy_number: 142
---

# Templates redesign Round 4 — synthesis after live bug + rename mandate + FS polish

User prompt (verbatim - composite of analyze-mode messages across ses_1983e857fffeO7svBxOQXm5Lr8 et al.):

> https://portal.desktop.ts.nowaker.net:8443/session/new?server=srv-2dy1srwz&directory=%2Fhome%2Fnowaker%2Fprojekty%2Fwebapps%2Fportal
>
> New session has init templates. It works like shit.
>
> First, let's redo settings
>
> Settings
>
> Appearance / Prompt / Composer / Chat / Files / Tools / Content / Notifications / Performance / Diagnostics
>
> Tools appear in the topbar action menu. Disable any you don't want to see; edit a system tool's prompt to customise it (your edit survives future updates and you can hit Reset to restore the shipped version). Add your own prompt templates with the button at the bottom. Use the Init checkbox on any template to mark it as a project-init template.
>
> Project init template ordering — Drag to reorder. When you create a new project, these templates are pre-checked in the create-project modal and concatenated in this order as the new session's first auto-prompt. <- always show to explain what init template is.
>
> Checkbox <- move from here... | Pull | Pull the latest changes from the remote repository. | Checkbox Hamburger <- to here | Checkbox INIT | Edit | ADD "Disable" button on stock tools. (no delete)
>
> Your custom tools | + Add custom tool <- sticky during scrolling down | git worktree -> main -> deploy -> push | [Custom] <- badge is useful, the section is called custom tools, that's enough | Edit | Delete
>
> Also show per project/workspace tools section, create them here in UI, show what level they're created on (full path starting from workspace as it is defined, eg. path could be /home/nowaker/projekty/something but Since root workspace here is defined as ~/projekty then must show as such). When created on project/any directory level, crate it in filesystem in .vibekick/templates/template-name.md. (openportal will be rebranding to vibekick, so we're already introducing its paths.)
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
> On new. Session create, when I check box enable an unit template, it shouldn't go to the prompt field. It should be prepended to prompt content on submit. Prompt history should remember it as: /template Full name 1 / /template full name 2 / [blank line] / User prompt here.
>
> [follow-up] fs templates: should allow to edit them when they're created. when refreshing list, don't dump the list only to rerender it. gracefully modify it. just indicate somewhere it's rescanning files. allow to duplicate a template - which means prefill everything as the existing one has, and let me modify if needed and create new. burger/init/slash should be fields on create too.
>
> [follow-up] also: read how "templates" are implemented now. there were some differences made in the meantime. also: bug - when i said: Prompt history should remember it as: /template Full name 1 ... i meant prompt history, feature of openportal. NOT the chat log opencode has. there, the AI must see the ENTIRE template. if it gets /template, it doesn't know shit about it.
>
> [follow-up] also: going to settings -> templates: Something went wrong! UnifiedToolList is not defined. ReferenceError: UnifiedToolList is not defined at An (https://portal.desktop.ts.nowaker.net/assets/settings-CP94QAF_.js:1:42148) ... also: they are no longer tools. we call them templates. anywhere they are mentioned, ui or code (including class names), must refer to as templates.

Design notes:

- Synthesizes AI_TODO #128 (Round 4 + /btw) + #127 (FS edit/duplicate/refresh/flags-at-create) into one coherent design captured in `ai-analysis-requests/TEMPLATES_REDESIGN.md` § "Round 4 (2026-05-30)". This entry is the queue marker; the linked doc is the design.

- **Four parallel explore agents** ran for ~10-12 min each: `bg_16dfa57d` (settings-tab + UnifiedToolList bug), `bg_f38e5ad5` (new-session flow + archive vs opencode split), `bg_88a7376f` (data model + .vibekick fs + YAML schema), `bg_51ff549e` (slash autocomplete; aborted but wrote doc before exit). Outputs: `ai-analysis-requests/TOOLS_SETTINGS_INVENTORY.md`, `NEW_SESSION_FLOW.md`, `TEMPLATES_DATA_MODEL_SCHEMA.md`, `COMPOSER_SLASH_AUTOCOMPLETE_WIRING.md`.

- **Live bug on main-nowaker (must fix first):** `tools-settings.tsx:748` references `<UnifiedToolList tools={tools} />` with no import or definition; `:681` references undefined `FsTemplateRow`; `:697` references undefined `NewFsTemplateForm`. `AddCustomTool` (470-568) body references 10+ undeclared identifiers — `burger`, `setBurger`, `init`, `setInit`, `slash`, `setSlash`, `error`, `saving`, `onClose`, `submit`. Partial merge from `feat/templates-redesign` to `main-nowaker` wired the JSX in before the supporting code landed. Settings -> Templates tab throws `ReferenceError: UnifiedToolList is not defined` at runtime.

- **Design reversal (locked):** new-session picker shows ONLY templates with `init: true && !isDisabled`. This reverses #126 / #127 which had walked Phase A back to "show all non-disabled, init pre-checked". User's Round 4 prompt explicitly reinstates the original Phase A behaviour ("Show only init tools on session create"). Future agents reading TEMPLATES_REDESIGN.md MUST NOT silently flip back; the doc carries an explicit anti-reversion note.

- **Rename mandate (Tools → Templates):** UI labels + component names + file names + type names ALL rename. **localStorage key `"opencode-tools"` stays stable** as an opaque storage handle — renaming silently wipes every user's custom templates + init order, which is not acceptable. **Stock template ids** (`git.pull`, `git.push`, `git.create-pr`) also stay stable — they're persisted by id in `disabledIds` / `projectInitOrder` / `slashCommandIds` arrays; renaming flips the user's "I disabled Pull" into "Pull is now visible again". A code comment at the persist-key declaration explains both stability decisions.

- **Archive vs opencode split (re-affirmed, no code change):** OpenPortal prompt archive (`prompts.raw_text`) stores compact `/template Foo\n/template Bar\n\nUser text`; opencode `prompt_async` payload sends fully-expanded bodies. Re-firing an archived row re-expands against the user's current templates. Per agent bg_f38e5ad5 the implementation already does the right thing at `new.tsx` submit handler — the user's clarification was about reader audience, not a code defect.

- **FS template polish (folded in from #127):** Edit-in-place on `FsTemplateRow` with location locked; SWR `keepPreviousData: true` + "Rescanning files..." indicator while `isValidating && data`; Duplicate button on Custom + FS rows opening the create form pre-filled; Burger/Init/Slash flag checkboxes inline on the create form. Refactor: collapse `NewFsTemplateForm` + `EditFsTemplateForm` + `DuplicateFsTemplateForm` into one `FsTemplateForm` with three modes (`new` / `duplicate` / `edit`).

- Implementation gated on explicit user go-ahead. This entry is the analysis deliverable.

Plan order (when implementation starts; on a fresh `feat/templates-redesign-round-4` worktree, NOT on main-nowaker which carries the broken partial merge):

1. **Bug fix isolated commit** — implement `UnifiedToolList`, `FsTemplateRow`, `NewFsTemplateForm`, and complete `AddCustomTool` state + `submit` handler. Verify `/settings#templates` renders without ReferenceError. Deploy via `scripts/deploy.sh`. Push to both remotes.
2. **Init-only filter** on new.tsx picker. Filter `t.init === true && !t.isDisabled`. Solo commit.
3. **Tools → Templates rename pass.** Symbol + file + label + type renames per the scope table in TEMPLATES_REDESIGN.md § Round 4. localStorage key + stock ids stay stable with explanatory comments. Solo commit.
4. **FS template polish** — Edit + Duplicate + flags-at-create + graceful refresh + `FsTemplateForm` consolidation.
5. **Slash command integration** (Phase E + Phase G of TEMPLATES_REDESIGN.md) including `/btw` parity on new.tsx composer.
6. Build + deploy + push between each phase. Browser-verify each phase.
