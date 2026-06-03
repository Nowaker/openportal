---
status: PENDING
commit: 
session: ses_1983fb909ffeVSIJakTMCpzx3O
queued_at: 2026-05-28T13:02:20-05:00
legacy_number: 127
---

# FS templates polish: editable rows, graceful refresh, duplicate-template flow, flags on create form

User prompt (verbatim):

> fs templates: should allow to edit them when they're created.
> when refreshing list, don't dump the list only to rerender it. gracefully modify it. just indicate somewhere it's rescanning files.
> allow to duplicate a template - which means prefill everything as the existing one has, and let me modify if needed and create new.
> burger/init/slash should be fields on create too.

Design notes:

- Follow-up to #119 + #125 + #126. Four small but visible UX bumps for the FS template surface:

  1. **Edit on FS templates**: FsTemplateRow currently exposes only flag toggles + Delete. Add the same inline edit affordance CustomToolRow has - Edit button toggles an in-row form for name/description/prompt; submit writes back to the YAML via `writeFsTemplate`. Stock and Custom already have this; FS was missing it.

  2. **Graceful refresh**: today, toggling a flag (or any write) calls `globalMutate(/api/vibekick-templates*)` which triggers an SWR refetch. Without `keepPreviousData`, the consumer sees `data === undefined` for the duration of the refetch and unmounts every row. Result: the entire list visibly empties and re-renders on every checkbox click. Fix: use SWR's `keepPreviousData` (or pass `revalidate: false` then patch the cache optimistically). Add a small inline indicator - "Rescanning files…" with the existing `<Loader>` glyph - next to the section heading whenever `isValidating` is true and the cache is non-empty.

  3. **Duplicate template**: new button per row (both Custom and FS) that opens the create-form pre-filled with the source template's name / description / prompt / flags. User edits, picks a new name (uniqueness handled by `makeCustomId` for custom, by `templateBasenameForName` collision check for FS), and submits as a new template. Source row is untouched. The create-form already exists; this is just a "pre-fill" entry point into it. Wire via an explicit `initialValues` prop on AddCustomTool + NewFsTemplateForm.

  4. **Flags on FS create form**: NewFsTemplateForm currently hardcodes `enabled: true, init: false, slash: false` at submit time. Surface the three flag checkboxes (Burger / Init / Slash) inline so the user can set them at creation. Same FlagCheckbox component the rows use; same wiring to local form state. The "Burger" flag in the form maps to YAML `enabled` field (backward-compat with the field name decided in #126).

- Carry-forward from #126:
  - new.tsx picker still shows enabled+init only - must change to all !isDisabled (init pre-checked).
  - Slash filter in new.tsx + $id.tsx still uses `tool.enabled` - must change to `!tool.isDisabled`.

- Plan order (highest user impact first):
  1. AI_TODO entry (this commit, AI_TODO-only)
  2. new.tsx picker: show all !isDisabled, init pre-checked
  3. Slash filter: !isDisabled instead of enabled in both composers
  4. FS Edit button + inline form
  5. Duplicate button on Custom + FS rows, hooked into create-form via initialValues prop
  6. NewFsTemplateForm: add Burger / Init / Slash checkboxes
  7. SWR keepPreviousData + "Rescanning files..." indicator
  8. Deploy + verify + push
  9. (Polish if budget) section headers, copy "tool"->"template", Select, PathInput, horizontal layout. Monospace audit report deliverable to user.
