# OpenPortal Filesystem Template Implementation Mapping

## Executive Summary

Current implementation spans:
- **Backend lib**: `vibekick-templates.ts` (462 lines) - core filesystem I/O, schema, validation
- **API route**: `vibekick-templates.ts` (129 lines) - GET/POST/DELETE handlers
- **Frontend hook**: `use-vibekick-templates.ts` (172 lines) - SWR cache, mutations
- **UI component**: `tools-settings.tsx` (1418 lines) - three template surfaces (system, custom localStorage, filesystem)

**Gaps identified**: No edit/duplicate/refresh in new-session picker; duplicate starts template creation with pre-filled form; no individual rescan; missing workspace-aware "new at location" flow

---

## 1. Filesystem Template Backend Schema

### FsTemplate (Read Shape)
**Location**: `apps/web/src/server/lib/vibekick-templates.ts:23-35`

```typescript
export interface FsTemplate {
  id: string;                    // Stable ID: "fs:<absolute_location>"
  name: string;                  // Display name from YAML frontmatter
  description?: string;          // From YAML, optional
  enabled: boolean;              // YAML flag (maps to burger visibility)
  init: boolean;                 // YAML flag (pre-checked in new-session picker)
  slash: boolean;                // YAML flag (registers /template <name> slash command)
  order: number;                 // YAML field (integer, defaults 0)
  prompt: string;                // Markdown body (outside frontmatter)
  location: string;              // Absolute filesystem path to .md file
  workspaceRoot: string;         // Configured workspace root the template lives under
  scope: string;                 // Relative path from workspaceRoot to the template
}
```

### FsTemplateInput (Write Shape)
**Location**: `apps/web/src/server/lib/vibekick-templates.ts:37-45`

```typescript
export interface FsTemplateInput {
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
  slash: boolean;
  order: number;
  prompt: string;
  // Location + workspaceRoot passed separately to writeTemplate()
}
```

### Filesystem Layout

```
<workspace>/<…subpath…>/.vibekick/templates/<slug>.md
```

YAML frontmatter format (minimal parser, not full YAML):
```yaml
---
name: Template Name
description: Optional description
enabled: true
init: false
slash: false
order: 0
---
Markdown prompt body here...
```

**Constraints**:
- File must end in `.md` (case-insensitive)
- Must live under `.vibekick/templates/` subdirectory
- Must be inside a configured workspace root (path-traversal guard)
- No nested directories under `templates/`

---

## 2. Backend Library API

### File I/O Functions

**`writeTemplate(location, workspaceRoot, input) → FsTemplate`**
- Creates `.vibekick/templates/` parent dirs recursively
- Serializes frontmatter + prompt body to the location
- Re-reads the file from disk to return the FsTemplate
- **Does NOT update the in-memory snapshot** - caller does via `applyTemplateUpdate()`
- Throws if re-read fails (defensive catch)

**`deleteTemplate(location) → void`**
- Unlinks the file (idempotent - silently succeeds if file already gone)
- **Does NOT update snapshot** - caller does via `applyTemplateDelete()`

**`readTemplateFile(location, workspaceRoot) → FsTemplate | null`**
- Reads a single .md file and parses frontmatter
- Returns null on read error (missing file, parse error)
- Slug fallback: if no `name` in YAML, uses filename without `.md`

### Filesystem Scanning

**`scanWorkspaceTemplates(workspaceRoot) → FsTemplate[]`**
- Recursive walk from `workspaceRoot`, skips heavy dirs (`.git`, `node_modules`, `.turbo`, `.next`, `.cache`, `build`, etc.)
- Finds every `<dir>/.vibekick/templates/*.md`
- Returns sorted array: `order` field first, then `scope` alphabetically
- Safe: returns `[]` if root doesn't exist or isn't a directory

**`templatesForDirectory(directory, workspaceRoot) → FsTemplate[]`**
- Used by new-session picker: walks UP from `directory` to `workspaceRoot`
- Collects templates from every `<cursor>/.vibekick/templates/` level
- Returns closest-to-leaf first; within each level sorts by `order` then alphabetically
- Used when opening new-session modal in a subdirectory context

**`resolveWorkspaceRoot(directory, workspaceRoots) → string`**
- Given a directory and list of configured workspace roots, finds the longest matching root
- Falls back to the directory itself (defensive - caller always gets a root)

### Workspace Root Validation

**`validateTemplateLocation(location, workspaceRoots) → {ok: true; workspaceRoot} | {ok: false; reason}`**
- Guards against path traversal: enforces `location` ends in `.md` and lives under `.vibekick/templates/`
- Enforces `location` starts with one of the configured workspace roots (after path resolution)
- Returns the matched workspace root if valid

### Caching Layer

**`getCachedSnapshot(workspaces) → Promise<CachedSnapshot>`**
- In-memory LRU cache of `{ workspaces: string[], templatesByLocation: Map<location, FsTemplate>, builtAt: number }`
- On miss, spawns a rebuild via `buildSnapshot()` (debounced - only one rebuild in flight)
- On workspace list change, invalidates and rebuilds
- Periodic refresh: `setInterval` rebuilds every 5 minutes (5 * 60 * 1000 ms)

**`forceRebuildSnapshot(workspaces) → CachedSnapshot`**
- Explicit user-triggered rescan (Refresh button in Settings)
- Synchronously rebuilds from disk, replaces cache

**`applyTemplateUpdate(template) → void`**
- Updates in-memory cache: `cache.templatesByLocation.set(template.location, template)`
- Used by API route after `writeTemplate()` succeeds
- **No disk I/O** - updates SWR frontend cache via a concurrent `globalMutate()` call in the hook

**`applyTemplateDelete(location) → void`**
- Removes from in-memory cache: `cache.templatesByLocation.delete(location)`
- Used by API route after `deleteTemplate()` succeeds

---

## 3. Frontend Hook API

**Location**: `apps/web/src/hooks/use-vibekick-templates.ts`

### Hook: `useAllFsTemplates()`

```typescript
function useAllFsTemplates(): SWRResponse<AllFsTemplatesResponse>
```

Returns:
```typescript
interface AllFsTemplatesResponse {
  workspaces: string[];      // List of configured workspace roots
  templates: FsTemplate[];   // All templates across all workspaces
  builtAt?: number;          // Snapshot build timestamp (optional)
}
```

**Behavior**:
- Key: `/api/vibekick-templates` (no query params)
- Fetcher: standard `fetch()` → JSON
- `keepPreviousData: true` - stale list stays painted during revalidation
- `revalidateOnFocus: false` - no auto-refetch on window focus
- Consumer reads `isValidating` to show "Refreshing…" spinner

### Hook: `useFsTemplatesForDirectory(directory?)`

```typescript
function useFsTemplatesForDirectory(directory?: string | null): SWRResponse<DirectoryFsTemplatesResponse>
```

Returns:
```typescript
interface DirectoryFsTemplatesResponse {
  directory: string;
  workspaceRoot: string;     // Resolved workspace root
  templates: FsTemplate[];   // Templates reachable from this directory
}
```

**Behavior**:
- Key: `/api/vibekick-templates?directory=<encoded>` (null key if `directory` is falsy - pauses fetch)
- Walks upward from directory to workspace root, returns closest-to-leaf templates
- Used by new-session picker to show context-aware template list

### Mutation: `writeFsTemplate(input) → Promise<FsTemplate>`

```typescript
interface FsTemplateWriteInput {
  location: string;
  name: string;
  description?: string;
  enabled: boolean;
  init: boolean;
  slash: boolean;
  order: number;
  prompt: string;
}
```

**Behavior**:
- POST to `/api/vibekick-templates` with JSON body (schema validated on server via Zod)
- Server returns `{ template: FsTemplate }`
- **Patching strategy**: `globalMutate((key) => key.startsWith("/api/vibekick-templates"), patchTemplateInPlace, {revalidate: false})`
  - Updates all cached lists (all-templates, directory-templates) in place
  - Replaces or appends the returned template by `location`
  - **No revalidation** - avoids backend rescan on every flag toggle (bug #150)
- Throws on 4xx/5xx response (with detailed error from server)

### Mutation: `deleteFsTemplate(location) → Promise<void>`

**Behavior**:
- DELETE to `/api/vibekick-templates?location=<encoded>`
- Patching: removes the template by `location` from all cached lists
- **No revalidation**
- Throws on error

### Mutation: `forceRescanFsTemplates() → Promise<AllFsTemplatesResponse>`

**Behavior**:
- GET `/api/vibekick-templates?rescan=1`
- Server rebuilds snapshot from disk
- **Explicit revalidation**: `globalMutate(ALL_KEY, data, {revalidate: false})`
- Used by manual "Refresh" button in Settings filesystem section

### Helper: `templateBasenameForName(name) → string`

```typescript
// Example: "My Template" → "my-template.md"
// - Lowercase, trim, replace non-alphanumeric with -, strip leading/trailing dashes
// - Truncate to 60 chars, fallback to "template" if empty
```

### Cache Patching Functions (Internal)

**`patchTemplateInPlace(current, template)`**
- If `current` is an object with a `templates` array, find the template by `location`
  - If found, replace the entry
  - If not found, append it
- Returns `{...current, templates: [...]}`
- Preserves `workspaces` and other fields in the response object

**`removeTemplateInPlace(current, location)`**
- Filters out the template by `location` from the `templates` array
- Preserves other fields

---

## 4. API Route Handlers

**Location**: `apps/web/src/server/vibekick-templates.ts`

### GET Handler

**No query params** (fetch all templates):
```typescript
GET /api/vibekick-templates
→ {
  workspaces: string[],
  templates: FsTemplate[],
  builtAt: number
}
```
- Hits `getCachedSnapshot(workspaces)` (periodic 5-min refresh)
- Optional query param `?rescan=1` → forces `forceRebuildSnapshot()`

**`?directory=<path>`** (fetch templates reachable from a directory):
```typescript
GET /api/vibekick-templates?directory=/abs/path/to/project
→ {
  directory: string,
  workspaceRoot: string,
  templates: FsTemplate[]
}
```
- Calls `templatesForDirectory()` (no caching - walks upward every time)

**`?workspace=<path>`** (fetch all templates under a workspace):
```typescript
GET /api/vibekick-templates?workspace=/abs/path/root
→ {
  workspaceRoot: string,
  templates: FsTemplate[]
}
```
- Calls `scanWorkspaceTemplates()` (no caching)

### POST Handler

```typescript
POST /api/vibekick-templates
Content-Type: application/json

{
  location: string,
  name: string,
  description?: string,
  enabled: boolean,
  init: boolean,
  slash: boolean,
  order: number,
  prompt: string
}
```

**Validation**:
- Schema check via Zod (required fields, type checks, length limits)
- Path validation: `validateTemplateLocation()` (must be under `.vibekick/templates/` in a configured workspace)

**Response**:
```typescript
200 OK
{ template: FsTemplate }
```

**On Error**:
```typescript
400 Bad Request
{ error: "reason string" }
```

**Mutations**:
1. Calls `writeTemplate(location, workspaceRoot, input)` → re-reads from disk
2. Calls `applyTemplateUpdate(template)` → updates in-memory snapshot

### DELETE Handler

```typescript
DELETE /api/vibekick-templates?location=<encoded>
```

**Validation**:
- `location` query param required
- Path validation (same as POST)

**Response**:
```typescript
200 OK
{ ok: true }
```

**Mutations**:
1. Calls `deleteTemplate(location)` → unlinks file
2. Calls `applyTemplateDelete(location)` → updates snapshot

---

## 5. UI Components

**Location**: `apps/web/src/components/tools-settings.tsx`

### FlagCheckbox (Reusable)
**Lines 85-117**
- Fixed width `w-14` label
- Inline checkbox + uppercase text label
- `disabled` prop grays out and prevents interaction
- Used for: Burger / Init / Slash flags on both template rows

### TemplateIconPicker (Reusable)
**Lines 119-164**
- Select dropdown with icon + label
- Presets: 15 icons from template-icons.tsx (`TEMPLATE_ICONS` array)
- Default icon (DocumentTextIcon) when `value` is undefined
- Used only when `isOutsideBurger` is true

### FsTemplateRow (Filesystem Template Row)
**Lines 822-987**
- Three flags: Burger (enabled), Init, Slash
- Edit button toggles edit mode
- **Duplicate button** (if `onDuplicate` prop provided) - triggers parent to open create form with pre-filled values
- Delete button with confirmation
- **Edit mode** (lines 943-984): name, description, prompt, Save/Cancel
- **Gap**: no individual rescan button on this row; only workspace-level refresh exists

### NewFsTemplateForm (Filesystem Create/Duplicate Form)
**Lines 989-1170**
- **Workspace selector** (Select dropdown) - lists configured workspace roots
- **Sub-path input** (PathInput) - optional project-relative subpath (e.g. `webapps/portal`)
- **Name, description, prompt** (Input + Textarea)
- **Flags**: Burger/Init/Slash checkboxes at create time
- **Basename generation**: calls `templateBasenameForName(name)` to derive `.md` filename
- **Path construction**: `${workspace}/${cleanSubpath}/.vibekick/templates/${basename}`
- **Initial values** (for duplicate flow): pre-fills all fields from duplicateSource template

### FsTemplatesSection (Filesystem Templates List)
**Lines 1172-1368**
- `useAllFsTemplates()` hook - loads all templates and workspaces
- **Grouped by workspace** (byWorkspace Map) - sorts within each workspace by order then scope
- **Refresh button** - calls `forceRescanFsTemplates()`
- **Create form toggle** - opens NewFsTemplateForm in create or duplicate mode
- **Duplicate source state** - when a row's Duplicate button fires, sets state to open the form with initial values

---

## 6. UI Patterns & Conventions

### PathInput Component
**Location**: `apps/web/src/components/ui/path-input.tsx`

**Props**:
```typescript
interface PathInputProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  entries: PathInputEntry[];   // Completion options (name, isDir)
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  appendSlashOnDir?: boolean;  // Auto-append / to directory entries
}
```

**Keybindings**:
- **Tab**: Completes to first matching entry (if prefix matches); appends `/` for directories
- **Enter**: Calls `onSubmit()`

**Current usage in tools-settings**: 
- SubPath field in NewFsTemplateForm
- **Gap**: no completion entries wired (just accepts plain text input)

### Select Component

**API**:
```typescript
<Select selectedKey={value} onSelectionChange={(k) => ...}>
  <SelectTrigger>Display</SelectTrigger>
  <SelectContent>
    <SelectLabel>Group Title</SelectLabel>
    <SelectItem id="key" textValue="label">Content</SelectItem>
  </SelectContent>
</Select>
```

**Current usage**:
- Workspace selector in NewFsTemplateForm
- Template icon picker (TemplateIconPicker)

---

## 7. Current Mutation & Revalidation Behavior

### Flag Toggle (Burger/Init/Slash)
**Flow**:
1. User clicks checkbox
2. Hook calls `writeFsTemplate({ location, ...fields, <flag>: next })`
3. POST to `/api/vibekick-templates`
4. Server: `applyTemplateUpdate(template)` updates in-memory snapshot
5. Hook: `globalMutate()` patches SWR cache in place (patchTemplateInPlace)
6. **No revalidation** - SWR cache is already correct from the patch

**Cache behavior**: All lists that contain this template see the update immediately
**Why no revalidate**: Avoids backend rescan on every toggle (old bug #150)

### Edit (Name/Description/Prompt)
**Same as flag toggle** - writes via `writeFsTemplate()`, patches in place

### Delete
**Flow**:
1. User clicks Delete + confirms dialog
2. Hook calls `deleteFsTemplate(location)`
3. DELETE to `/api/vibekick-templates?location=...`
4. Server: `applyTemplateDelete(location)` updates snapshot
5. Hook: `globalMutate()` patches SWR cache (removeTemplateInPlace)

### Create (New or Duplicate)
**Flow**:
1. User fills form and clicks Create
2. Hook calls `writeFsTemplate({ location, ...input })`
3. POST succeeds, returns new FsTemplate
4. Hook patches cache (appends since location is new)
5. Form closes, parent state resets
6. **No explicit revalidation** - the patch contains the new template

### Manual Refresh (Filesystem Section)
**Flow**:
1. User clicks Refresh button
2. Hook calls `forceRescanFsTemplates()`
3. GET `/api/vibekick-templates?rescan=1`
4. Server: `forceRebuildSnapshot()` scans disk from scratch
5. Hook: `globalMutate(ALL_KEY, data, {revalidate: false})` replaces all-templates cache
6. Directory-scoped caches (`useFsTemplatesForDirectory`) revalidate on next poll (separate code path, not snapshot-cached)

**Why separate directory path**: Directory templates call `templatesForDirectory()` server-side, which is NOT cached (always walks upward) - so directory lists eventually catch up without explicit refresh

---

## 8. Missing Functionality & Gaps

### AI_TODO #142 Requirements Not Yet Implemented

#### 1. **Edit Filesystem Templates**
- ✅ **Exists partially**: FsTemplateRow has Edit button + form (lines 822-987)
- ❌ **Gap**: No "Edit" button or modal in new-session picker context (only in Settings)
- ❌ **Gap**: No individual template refresh (only workspace-level)

#### 2. **Duplicate Filesystem Templates**
- ✅ **Exists**: FsTemplateRow.onDuplicate → sets duplicateSource state
- ✅ **NewFsTemplateForm** accepts initialValues from duplicateSource
- ❌ **Gap**: No confirmation/progress feedback during duplicate (creates immediately)
- ❌ **Gap**: No "copy to workspace X" flow (always creates in same workspace)

#### 3. **Set Flags at Create Time**
- ✅ **Exists**: NewFsTemplateForm has Burger/Init/Slash checkboxes (lines 1130-1148)
- ✅ **Form stores flags and writes to disk**
- ❌ **Gap**: Flags not available at *duplicate* source selection (just copy from source)
- ❌ **Gap**: No flag editing UI during duplication (edit form after creation only)

#### 4. **Refresh Individual Template or Workspace**
- ✅ **Workspace refresh**: Refresh button in FsTemplatesSection (lines 1261-1269)
- ❌ **Template-level refresh**: No per-row rescan (e.g., after editing .md on disk)
- ❌ **Directory refresh**: New-session picker has no refresh (relies on 5-min periodic or manual Settings refresh)

#### 5. **Tools → Templates Rename**
- ❌ **Not started**: UI still says "Tools" in headers, buttons, flag labels
- ❌ **"Hamburger" → "Burger" in labels**: Already mostly done
- ❌ **Terminology**: "System templates" vs "Your templates" - unclear in new-session context

### Additional Gaps

#### Path Completion in New-Session Context
- ❌ PathInput in NewFsTemplateForm has no completion entries wired
- ❌ No `/api/fs/list` call to populate directory completions
- Workaround: Users type paths freehand

#### Workspace-Aware Creation
- ❌ No "Create in this workspace" context from sidebar or new-session picker
- ⚠️ Form defaults to first workspace, user must select

---

## 9. Reusable UI Components Available

### From tools-settings.tsx
1. **FlagCheckbox** - checkbox with fixed-width label, disabled state
2. **TemplateIconPicker** - Select with icon previews
3. **FsTemplateRow** - template display row with flags, edit, delete, duplicate
4. **NewFsTemplateForm** - create/duplicate form with workspace + subpath + fields + flags
5. **AddCustomTool** - inline create form pattern (localStorage templates, but reusable)

### From ui/ components
1. **Select / SelectTrigger / SelectContent / SelectItem** - dropdown (Heroicons style)
2. **PathInput** - text input with Tab completion keybinding (currently unused for completions)
3. **Input / Textarea** - base form fields
4. **Button** - with intent (outline, danger, primary) and size (xs, sm)
5. **Loader** - spinner icon

---

## 10. Summary: Current State vs. Round 4 Scope

| Feature | Status | Location | Gaps |
|---------|--------|----------|------|
| Read FS templates | ✅ | Hook + API | Directory-aware picker missing |
| Create FS template | ✅ | Form + POST | No path completion |
| Edit FS template | ✅ | FsTemplateRow | Settings-only, not in picker |
| Duplicate FS template | ✅ | Row button → Form | No confirmation feedback |
| Set flags at create | ✅ | NewFsTemplateForm | Not at duplicate time |
| Delete FS template | ✅ | DELETE handler | Working |
| Refresh workspace | ✅ | Refresh button | Works but explicit |
| Refresh template | ❌ | — | No per-row refresh |
| Refresh directory | ❌ | — | No per-directory refresh |
| Icon picker | ✅ | TemplateIconPicker | Works, but not wired to FS templates |
| Slash command support | ✅ | Flag in YAML | Implemented backend |

