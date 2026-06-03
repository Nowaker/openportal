---
status: PENDING
commit: 
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-26T23:45:14-05:00
legacy_number: 128
---

# Templates/settings/new-session redesign round 4 + slash trigger bug (/btw)

User prompt (verbatim):

> https://portal.desktop.ts.nowaker.net:8443/session/new?server=srv-2dy1srwz&directory=%2Fhome%2Fnowaker%2Fprojekty%2Fwebapps%2Fportal
>
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
>
> I don't know anything about /btw.
>
> I type in /btw into prompt field as the first thing, and nothing shows up on the slash commands list.

Design notes:

- This is a deep follow-up to #119/#125/#126/#127. The deliverable is one coherent templates system across Settings -> Tools, slash autocomplete, and New Session create semantics.
- Functional correctness items to close:
  1. Slash command discovery in composer must include user template aliases and show matches immediately for "/btw"-style commands.
  2. New-session template checks must not mutate visible textarea content; template payload is prepended only at submit-time.
  3. Prompt archive/history should persist synthetic header lines (`/template ...`) before user text so reruns preserve the intent.
  4. Settings Tools list must render unified inline controls (burger/init/slash + drag handle), no detached ordering list.
  5. System template row gets explicit Disable button (no delete), custom/fs rows keep Edit/Delete and add Duplicate.
  6. Workspace/filesystem templates remain path-aware and root-relative display (`~/projekty/...`) and are recursively discoverable in settings.
- Additional user follow-up from reminder (same scope): FS template rows must be editable, refresh should keep list painted with a "rescanning" indicator, duplicate flow should prefill create form, and create form must include burger/init/slash fields.
