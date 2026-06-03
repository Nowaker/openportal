---
status: DONE
commit: 
session: ses_18cd90b4effeWgohIGbJD9tVkE
queued_at: 2026-06-01T08:36:32-05:00
legacy_number: 150
---

# FS templates: backend snapshot cache + periodic rebuild + manual Refresh button

User prompt (verbatim):

> > Scanning workspaces for .vibekick/templates/…
>
> any change, e.g. setting one of my fs based templates to on/off init makes the whole thing rescan from scratch again, and then unable to make further changes until rescanning is done. it makes no sense really. scanning should happen in openportal backend, periodically. serve settings for .vibekick/templates directly from there, super fast. add a custom refresh button in settings to force a rescan.

Design notes:

- Root cause: previous `writeFsTemplate` / `deleteFsTemplate` in `apps/web/src/hooks/use-vibekick-templates.ts` called `globalMutate(<all vibekick keys>, undefined, { revalidate: true })` after every disk write. SWR fired a refetch, which hit `apps/web/src/server/vibekick-templates.ts` GET handler, which called `listAcrossWorkspaces()` -> `scanWorkspaceTemplates` -> full filesystem walk on every flag toggle. UI sat in "Rescanning files…" state for the duration, blocking the user from clicking another flag.
- Backend cache: new in-memory snapshot in `apps/web/src/server/lib/vibekick-templates.ts`:
  - `CachedSnapshot { workspaces, templatesByLocation: Map<string, FsTemplate>, builtAt }`
  - `getCachedSnapshot(workspaces)`: returns cached if workspace list matches; else rebuilds via `scanWorkspaceTemplates` across all roots. First-call latency = same as before; subsequent calls = constant time.
  - `forceRebuildSnapshot(workspaces)`: explicit rebuild, replaces the cache.
  - `applyTemplateUpdate(template)`: location-keyed Map insert/replace; called by the POST handler after `writeTemplate`.
  - `applyTemplateDelete(location)`: Map delete; called by the DELETE handler after `deleteTemplate`. Handler also calls with the path-resolved-tilde variant to cover legacy callers passing `~/...` location.
  - `setInterval(..., 5 * 60 * 1000)`: periodic background rebuild every 5 minutes. Catches drift from edits made outside the UI (git pull, hand-edits to `.md` files). Triggers only when there's already a cache (avoids spam-rebuild before first request). Errors swallowed - next read rebuilds.
- Route handler:
  - GET no-arg path consults the cache via `getCachedSnapshot`. New `?rescan=1` query param invokes `forceRebuildSnapshot` instead.
  - POST handler unchanged write path, plus `applyTemplateUpdate(returnedTemplate)` after the write so the cache stays consistent with disk.
  - DELETE handler unchanged delete path, plus `applyTemplateDelete(location)` after the unlink.
  - Directory-scoped GET (used by new-session picker) still hits `templatesForDirectory` directly. That call is a small upward walk (current dir up to workspace root) — not the source of the user's complaint.
- Frontend hook (`apps/web/src/hooks/use-vibekick-templates.ts`):
  - `writeFsTemplate`: patches SWR cache in place with the returned template (`{ revalidate: false }`). NO refetch fires.
  - `deleteFsTemplate`: removes from SWR cache in place (`{ revalidate: false }`). NO refetch fires.
  - New `forceRescanFsTemplates`: GET `/api/vibekick-templates?rescan=1`, patches `ALL_KEY` cache with response (`{ revalidate: false }`). Directory-scoped caches catch up on their natural revalidate cycle.
  - The `revalidate: false` on writes is a hard architectural choice - re-enabling it reintroduces the bug. Inline anti-reversion comment explains.
- Settings UI (`apps/web/src/components/tools-settings.tsx` FsTemplatesSection):
  - New "Refresh" button in the section header (top right, `ml-auto` placement). Calls `forceRescanFsTemplates` + tracks `rescanning` local state for the loading affordance.
  - Replaces the legacy "Rescanning files…" indicator (which fired on every flag toggle, often spamming the header). The new indicator fires only on real rescans (`rescanning || isValidating && data`).
  - Inline error display below the description if the rescan POST fails.
  - Description paragraph updated to explain the caching model + when to hit Refresh ("flag toggles update the cache in place (no rescan). Hit Refresh to force a fresh disk scan now.").
- Branch: `fix/fs-templates-backend-cache` off `main-nowaker` (at the time, ecb06dc).
