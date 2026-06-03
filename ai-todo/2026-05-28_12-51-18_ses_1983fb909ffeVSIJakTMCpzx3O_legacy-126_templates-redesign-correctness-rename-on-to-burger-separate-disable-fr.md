---
status: PENDING
commit: 
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-28T12:51:18-05:00
legacy_number: 126
---

# Templates redesign correctness: rename "On" to "Burger", separate Disable from Burger, show all non-disabled on new-session, fix slash filter to ignore burger state

User prompt (verbatim):

> On — visible in the topbar Tools menu. -> rename to "burger"
> Init — pre-checked in the create-project modal and concatenated (in drag order below) as the new session's first prompt. 
> Slash — appears in the composer "/" autocomplete as /template Full name. Accepting it replaces the token with the template body.
> "disable" -> totally disables the template. deselects all  like it doesn't exist. equivalent of delete for user defined ones, except it's the system so it cannot be deleted. should visualize as disabled, e.g. opacity change or something. must click enable to get it back. 
>
> "burger" deselected shouldn't hide template from the init template list on create new session. "burger" just toggles whether it's shown in burger. only "
> then - "init" means it's default on on session new screen. all other non-disabled templates are to be shown.
>
>
> slash command behavior: not up to the spec i provided: If enabled as slash command, it shows on the list of /slashcommands as "/template Full name here" on the list, and when activated, immediately replaces itself with that template's content + padding up to 2x \n before and after so proper spacing is added before/after content (if any). Only show templates active for a given project (not disabled), only. Current project, and all directories down to the workspace root.

Design notes:

- Follow-up to #125. The "On" checkbox in my Phase D layout had ambiguous semantics: it was simultaneously "is this template in the burger menu?" and "is this template enabled at all?". The user splits them.
- **New 4-state model** per template:
  - `disabled` (master kill): when set, the row renders dimmed, all three flags appear visually deselected and uninteractive, and the template does not appear in the burger menu / init picker / slash popover. Equivalent of Delete for custom + FS templates which can be removed entirely; stock templates can't be deleted so they get this soft-disable instead.
  - `burger` (was "On"): controls topbar burger menu visibility only. NOT a kill switch.
  - `init`: pre-checked default on new-session picker. Order is `projectInitOrder` as before.
  - `slash`: registers the template as a `/template <name>` slash command. Filtered by `!disabled && slash` (NOT by burger).
- **New-session picker semantics change**: previously the picker showed ONLY templates with `init` checked. New behaviour: picker shows ALL non-disabled templates; init-marked ones are pre-checked + ordered first (per `projectInitOrder`); non-init ones appear alphabetically after; user can opt in/out of any individual template via checkbox before submitting.
- **Slash filter fix**: my Phase D filter was `tool.enabled && tool.isSlash`. Under the new model, `enabled` is no longer the right gate - the slash popover must show templates where `!isDisabled && isSlash`. A template with Burger unchecked but Slash checked MUST appear in the popover (it just doesn't appear in the topbar burger menu).
- **Data model**:
  - `disabledIds` keeps its name in localStorage but its semantic shifts to "not in burger menu" (was: "fully disabled"). Existing users who unchecked "On" on a tool now see that tool out of the burger menu but still in the init picker / slash popover, which is closer to what they probably wanted anyway.
  - New field `templateDisabledIds: string[]` tracks the master-disable state. Default empty.
  - Resolver: `isInBurger = !disabledIds.has(id)`, `isDisabled = templateDisabledIds.has(id)`, plus a backward-compat `enabled = isInBurger && !isDisabled` for existing callers (topbar burger menu, etc.).
- **FS template YAML**: the `enabled` field in `.vibekick/templates/*.md` frontmatter gets a semantic rename - it now means `burger`. Acceptable break since no user has shipped FS templates in the wild yet (the feature is brand-new this week). YAML reader treats either `enabled` or `burger` as the burger flag for backward-compat.
- **UI affordances**:
  - Stock template row: Edit + Disable/Enable button (toggles `templateDisabledIds`); never Delete.
  - Custom template row: Edit + Delete (removes from `customTools`); no Disable.
  - FS template row: Edit + Delete (removes file); no Disable.
  - All three row types render with `opacity-50` + pointer-events-none on flag checkboxes when the row is in `templateDisabledIds` (only applicable to stock - custom/FS get fully removed instead).
- Folds in pending Phase D2 polish: workspace-root native `<select>` -> `<Select>`, sub-path `<Input>` -> `<PathInput>` with `/api/fs/list` completion, horizontal label/field layout for small fields, "tool" -> "template" copy update everywhere.
- Plan order: store schema change first (foundation), then tools-settings.tsx UI rewrite (big), then callers (new.tsx + $id.tsx) in parallel, then FS YAML schema, then deploy + verify.
