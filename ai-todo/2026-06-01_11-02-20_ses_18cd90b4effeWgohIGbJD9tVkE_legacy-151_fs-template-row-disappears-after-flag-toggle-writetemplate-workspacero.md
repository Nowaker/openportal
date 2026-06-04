---
status: DONE
session: ses_18cd90b4effeWgohIGbJD9tVkE
queued_at: 2026-06-01T11:02:20-05:00
legacy_number: 151
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# FS template row disappears after flag toggle - writeTemplate workspaceRoot regression fix

User prompt (verbatim):

> still same shit:
>
> > now clicking init on fs template DISAPPEARS that entry, and it only will go back when i hit refresh. stupid.

Design notes:

- Regression from #150 (backend snapshot cache). When the user toggles a flag on a filesystem template at any nested path like `/home/nowaker/projekty/dreamhost/.vibekick/templates/env-dreamhost.md`, the row disappears from Settings until manual Refresh.
- Root cause: `writeTemplate` in `apps/web/src/server/lib/vibekick-templates.ts` derived `workspaceRoot` via `dirname(dirname(dirname(expanded)))` to pass to `readTemplateFile` for the post-write re-read. That gives `/home/nowaker/projekty/dreamhost` (the `.vibekick` grandparent dir), NOT the configured workspace root `/home/nowaker/projekty`.
- Downstream effect: the returned `FsTemplate.workspaceRoot` is `/home/nowaker/projekty/dreamhost`. The frontend `FsTemplatesSection` groups templates by `tpl.workspaceRoot` and iterates `workspaces` from the API response (which contains the configured roots). `byWorkspace.get("/home/nowaker/projekty")` → undefined → row hidden. Refresh rescans via `scanWorkspaceTemplates(configuredRoot)` which gets the workspaceRoot right, so the row reappears.
- Fix: `writeTemplate(location, workspaceRoot, input)` - takes the validated `workspaceRoot` from the API layer (which already called `validateTemplateLocation` and got the matching configured root). Passes it to `readTemplateFile` so the re-read template's `workspaceRoot` matches the workspaces array key.
- Earlier attempt at the SAME fix (commit `0ce97da` on branch `fix/fs-write-workspace-root`) was silently reverted between merge and now (the file's git log on main-nowaker shows the broken code as last touched in `3f661b9`, my fix nowhere to be found). Re-applied on `fix/fs-write-workspace-root-redo` with a load-bearing anti-reversion comment baked into the function docstring so the next agent who looks at the signature can't re-derive the parent from the file path without reading WHY that's wrong.
- Callers updated:
  - `apps/web/src/server/vibekick-templates.ts` POST handler passes `validation.workspaceRoot`
  - `apps/web/src/server/lib/vibekick-templates.test.ts` - all 9 test callsites updated to pass `workspaceRoot` (the fixture variable). All 16 vibekick tests + 13 prompt-template-format tests pass.

Files:
- `apps/web/src/server/lib/vibekick-templates.ts` (signature + anti-reversion comment)
- `apps/web/src/server/vibekick-templates.ts` (caller)
- `apps/web/src/server/lib/vibekick-templates.test.ts` (9 callsite updates)
