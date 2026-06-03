---
status: PENDING
commit: 
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-28T13:02:20-05:00
legacy_number: 127
---

# Templates redesign correctness round 3: FS template edit/duplicate, graceful refresh, Burger/Init/Slash on create

User prompt (verbatim):

> fs templates: should allow to edit them when they're created.
> when refreshing list, don't dump the list only to rerender it. gracefully modify it. just indicate somewhere it's rescanning files.
> allow to duplicate a template - which means prefill everything as the existing one has, and let me modify if needed and create new.
> burger/init/slash should be fields on create too.

Design notes:

- Follow-up to #119 + #125 + #126. FS-template UX polish.
- **Edit FS templates**: existing FsTemplateRow had Delete only - now needs an Edit button that pops an inline form pre-filled with the row's current name/description/burger/init/slash/order/prompt. Submitting overwrites the same .md file (location is locked - user can't move an existing template via the Edit UI; they'd Delete + New + Duplicate-like flow for that). Cancel discards drafts.
- **Duplicate**: new button on FsTemplateRow that opens the create form pre-filled with the source row's contents - workspace pre-selected, sub-path inherited (but editable), name/description/prompt populated, flags copied. User edits as needed and clicks Create. Lands as a NEW file at the new location with a fresh slug.
- **Burger/Init/Slash on create**: NewFsTemplateForm currently hard-codes init:false / slash:false / enabled:true. Surface all three flags as checkboxes in the form so the user can pre-mark a new template as init / slash / burger-hidden at creation time. Same three checkboxes used in the row UI - reuse FlagCheckbox.
- **Graceful refresh**: useAllFsTemplates currently lets SWR replace data with `undefined` while revalidating, which dumps the visible list to a loader. Switch to `keepPreviousData: true` so the cached list stays painted while new data is fetched. Expose `isValidating` from the SWR result and render a small "Rescanning .vibekick/templates/..." indicator on the section header. Same treatment for useFsTemplatesForDirectory.
- **Refactor approach**: instead of duplicating NewFsTemplateForm into NewFsTemplateForm + EditFsTemplateForm + DuplicateFsTemplateForm, parameterise into one FsTemplateForm with three modes - `{ mode: "new" | "duplicate", workspaces, initialValues? }` for new/duplicate and `{ mode: "edit", template }` for edit (location locked). Render mode-specific labels ("Create" vs "Save" vs "Create copy"), share field rendering + validation. DRY principle.
- **Form behaviour by mode**:
  - new: empty fields; workspace = workspaces[0]; sub-path empty; flags default (burger:true, init:false, slash:false); button "Create"
  - duplicate(source): workspace = source's; sub-path = source's parent; fields = source's; flags = source's; button "Create copy"; on success, the parent collapses the duplicate form and the new row appears in the list via SWR revalidation
  - edit(target): workspace + sub-path locked (read-only display); fields = target's; flags = target's; button "Save"; on success, the same .md file is overwritten and the row updates in-place via SWR's keepPreviousData
- **Also folds in**: the rest of #125 polish that hasn't shipped yet - section headers "System templates / Your templates - global / Your templates - filesystem", native `<select>` -> `<Select>` for workspace root, plain `<Input>` -> `<PathInput>` for sub-path, horizontal label/field layout for small fields (workspace / sub-path / name / description), "tool" -> "template" copy update everywhere.
- **Also folds in**: #126 last bits - new-session picker shows ALL non-disabled (with init pre-checked); slash filter uses `!isDisabled` not `enabled`.
- Plan order (single commit after all the changes land cleanly):
  1. AI_TODO #127 entry (in this commit OR separate dedicated AI_TODO commit)
  2. use-vibekick-templates.ts - keepPreviousData + expose isValidating
  3. tools-settings.tsx - comprehensive rewrite covering #125 + #126 + #127
  4. new.tsx - picker shows-all-non-disabled + slash filter !isDisabled
  5. \$id.tsx - slash filter !isDisabled
   6. build + deploy + push + browser-verify
