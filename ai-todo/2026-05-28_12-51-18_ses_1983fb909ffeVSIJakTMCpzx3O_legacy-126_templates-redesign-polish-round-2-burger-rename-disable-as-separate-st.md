---
status: PENDING
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-28T12:51:18-05:00
legacy_number: 126
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Templates redesign polish (Round 2): Burger rename, Disable as separate state, new-session shows all non-disabled, slash filter respects only disabled

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

- Follow-up to #119 + #125 that splits the conflated "enabled" concept into TWO orthogonal axes:
  - **Burger** (per-row checkbox): controls visibility in the topbar Tools/Burger menu ONLY. Default = visible. Burger OFF still shows the template in the new-session picker, the slash autocomplete (if slash flag is set), etc. Effectively the old "On"/"enabled" semantic narrowed to the topbar surface.
  - **Disabled** (per-row button toggling state): totally hides the template from every surface - topbar, new-session picker, slash autocomplete. Equivalent to soft-delete for stock templates that can't be hard-deleted. Click Enable to restore. Visualize as `opacity-50` (or similar) with the three flag checkboxes greyed-out while disabled.

- **State model**:
  - Tools-store: rename existing `disabledIds` slice -> `burgerHiddenIds` (semantic shift: now means "hidden from topbar burger menu", not "fully disabled"). Add new `fullyDisabledIds: string[]`. Add `toggleFullyDisabled(id, next)` mutator.
  - `ResolvedTool` shape: replace `enabled` field with TWO fields - `burgerVisible: boolean` (= !burgerHiddenIds.includes(id)) and `fullyDisabled: boolean` (= fullyDisabledIds.includes(id)).
  - Migration: zustand persist `migrate` hook. Old `disabledIds` entries map to `fullyDisabledIds` (preserves user intent - if they previously chose "I don't want this", new "disabled" state matches the old "fully hidden" behavior). Existing `disabledIds` localStorage values silently move to `fullyDisabledIds` and the key is cleared.

- **Resolver across surfaces**:
  - Topbar (app-sidebar-nav.tsx): show iff `burgerVisible && !fullyDisabled`.
  - New-session picker (new.tsx): show iff `!fullyDisabled` (ALL non-disabled templates, regardless of init flag). Pre-check the ones in `projectInitOrder`. User can manually check / uncheck any non-disabled template.
  - Slash popover (both composers): show iff `isSlash && !fullyDisabled`. Burger flag is irrelevant for slash.
  - Settings list: show all templates regardless of state. Disabled rows render with `opacity-50` + disabled-state checkboxes.

- **FS templates** also need this model:
  - YAML frontmatter gains `burger: true` field (default true). Existing `enabled: true` field semantically shifts to "not fully disabled" (default true).
  - Migration on existing FS templates: missing `burger` defaults to true (backward compat).
  - Toggle in Settings rewrites YAML same as the other flags.

- **Slash spec verification**:
  - User said "not up to the spec i provided". My current filter is `enabled && isSlash`. After the rename + new semantics: filter becomes `!fullyDisabled && isSlash`. A template with Burger OFF but Slash ON will now correctly appear in the slash popover.
  - Confirmed all other slash-spec items already shipped (4ff5680): popover display as `/template <full-name>`, body expansion with \n\n padding, scope walk-up-to-workspace-root for FS templates.

- Plan:
  1. AI_TODO entry (this commit, AI_TODO-only)
  2. tools-store: schema migration + new flags + mutator
  3. tools-settings.tsx: Burger label rename + Disable button rewires fullyDisabled + visual disabled state + section headers + horizontal label layout + Select + PathInput
  4. ResolvedTool / resolver consumers (new.tsx, $id.tsx, app-sidebar-nav.tsx, folder-browser.tsx) - update each call-site
  5. New-session picker: show-all-non-disabled (not just init)
  6. Slash filter: !fullyDisabled instead of enabled
  7. FS templates: add `burger` to YAML schema
  8. Build + deploy + push + verify in browser
  9. Deliver monospace audit report (carried forward from #125)
