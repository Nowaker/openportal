# Tools/Templates Settings UI — Complete Implementation Inventory

**Date**: 2026-05-30  
**Scope**: Diagnostic report on current implementation + UnifiedToolList ReferenceError root cause  
**Status**: Complete audit of all files, components, state, and API surface

---

## 1. Settings Page Structure

**File**: `apps/web/src/routes/_app/settings.tsx`

### Tab Configuration
- **Lines 1659-1675**: Hash-routed tab list with legacy "tools" → "templates" redirect
- **Tab array**: `["appearance", "prompt", "composer", "chat", "files", "templates", "content", "notifications", "performance", "diagnostics"]`
- **Legacy redirect** (lines 1672-1673, 1695-1696): `hash === "tools" ? "templates" : "appearance"`
- **Tab UI** (lines 1759-1761): `<Tab id="templates">` with `WrenchScrewdriverIcon` label "Templates"
- **TabPanel**: Rendered after line 2029 (not shown in excerpt, but referenced as `<TabPanel id="templates" className="pt-6">`

### Import
**Line 9**: `import { ToolsSettings } from "@/components/tools-settings";`

---

## 2. Component Inventory + UnifiedToolList Bug Diagnosis

### File: `apps/web/src/components/tools-settings.tsx` (757 lines)

#### Components DEFINED (working):
1. **`FlagCheckbox`** (lines 77-109)
   - Renders 3-column checkbox cluster for tool flags (On/Init/Slash)
   - Props: `label`, `checked`, `onChange`, `title`, `disabled`

2. **`SystemToolRow`** (lines 122-298)
   - Renders a system tool row with drag handle, flag checkboxes, edit form
   - Props: `ToolRowProps` interface (lines 111-120)
   - Stores: uses `useToolsStore` getters + setters for Burger/Init/Slash/Disable/Override

3. **`CustomToolRow`** (lines 300-468)
   - Renders a custom tool row with edit/delete buttons
   - Props: `ToolRowProps` interface
   - Stores: uses `useToolsStore` for flag/tool CRUD

4. **`AddCustomTool`** (lines 470-568) — **INCOMPLETE**
   - **Bug**: References undefined state variables: `burger`, `setBurger`, `init`, `setInit`, `slash`, `setSlash`, `onClose`, `error`, `saving`, `submit`
   - **Lines with undefined refs**:
     - 531: `checked={burger}` ← undefined
     - 532: `onChange={setBurger}` ← undefined
     - 537: `checked={init}` ← undefined
     - 538: `onChange={setInit}` ← undefined
     - 543: `checked={slash}` ← undefined
     - 544: `onChange={setSlash}` ← undefined
     - 548: `{error && ...}` ← undefined (never set)
     - 553: `onPress={onClose}` ← undefined
     - 554: `isDisabled={saving}` ← undefined
     - 560: `isDisabled={saving || ...}` ← undefined
     - 561: `onPress={submit}` ← undefined
     - 563: `{saving ? "Saving..." : "Create"}` ← undefined
   - Should declare state: `const [burger, setBurger] = useState(false)` etc.
   - Should declare `const [saving, setSaving] = useState(false)` and `const [error, setError] = useState("")`
   - Should declare `const submit = async () => { ... }` and `const onClose = () => { ... }`

5. **`FsTemplatesSection`** (lines 570-712)
   - Renders filesystem templates grouped by workspace
   - Calls **undefined** component: `FsTemplateRow` (line 681)
   - Calls **undefined** component: `NewFsTemplateForm` (line 697)
   - Hooks: `useAllFsTemplates()`, `writeFsTemplate()`, `deleteFsTemplate()`

6. **`ToolsSettings`** (lines 714-757) — **EXPORTED, HAS CRITICAL BUG**
   - **Line 748: `<UnifiedToolList tools={tools} />`** ← **ReferenceError: UnifiedToolList is not defined**
   - This component is NEVER imported, NEVER defined anywhere in the codebase
   - **Expected**: should render `SystemToolRow` + `CustomToolRow` sections
   - Hooks: `useResolvedTools()` (lines 33-59)

#### Components MISSING (not defined, called but undefined):
1. **`UnifiedToolList`** — referenced line 748
   - **Root cause of ReferenceError**
   - Should wrap system tools + custom tools sections
   - Expected shape: `function UnifiedToolList({ tools: ResolvedTool[] }) { ... }`

2. **`FsTemplateRow`** — referenced line 681
   - Should render a single filesystem template row with edit/delete/toggle
   - Expected props: `{ template: FsTemplate, onToggle, onSaveEdit, onDelete }`

3. **`NewFsTemplateForm`** — referenced line 697
   - Should render a form to create a new filesystem template
   - Expected props: `{ workspaces: string[], onClose: () => void }`

---

## 3. Templates State Model

### Persisted Store: `apps/web/src/stores/tools-store.ts`

**localStorage key**: `"opencode-tools"` (line 254)

#### ToolsPersistedState Interface (lines 31-76):
```typescript
disabledIds: string[]              // Fully disabled tools (hidden everywhere)
burgerHiddenIds: string[]          // Hidden from topbar burger menu only
systemOverrides: Record<string, {  // Per-tool prompt/name overrides
  name?: string
  prompt?: string
}>
customTools: CustomTool[]          // User-created tools
projectInitOrder: string[]         // Init template ids in drag-drop order
slashCommandIds: string[]          // Tool ids for /template slash commands
```

#### CustomTool Interface (lines 5-10):
```typescript
id: string
name: string
description?: string
prompt: string
```

#### ResolvedTool Union Type (lines 12-29):
Combines SystemTool | CustomTool with computed flags:
```typescript
isInBurger: boolean     // Visible in topbar Tools menu
isDisabled: boolean     // Fully disabled (grayed out, hidden)
enabled: boolean        // isInBurger && !isDisabled (backward-compat alias)
isInit: boolean         // Pre-checked in new-session picker
isSlash: boolean        // Available as /template <name> command
isOverridden?: boolean  // (system tools only) prompt/name customized
```

#### Store Methods:
- `setBurgerVisible(id, visible)` — toggle Burger flag
- `setFullyDisabled(id, disabled)` — toggle fully-disabled state
- `toggleProjectInit(id, enabled)` — toggle Init flag + membership in projectInitOrder
- `reorderProjectInit(order)` — drag-drop reordering
- `toggleSlashCommand(id, enabled)` — toggle slash-command membership
- `setSystemOverride(id, override)` — store prompt/name override
- `resetSystemOverride(id)` — drop override, fall back to system default
- `upsertCustomTool(tool)` — create or update custom tool
- `removeCustomTool(id)` — delete custom tool + clean flags

#### Helper Function:
- `resolveToolsFromState(state)` — pure derivation, returns `ResolvedTool[]` with all flags computed

---

## 4. Stock Template List

**File**: `apps/web/src/lib/prompt-tools.ts`

#### SystemTool Interface (lines 19-24):
```typescript
id: string
name: string
description: string
prompt: string
```

#### SYSTEM_TOOLS Constant (lines 72-91):
Three shipped templates:
1. **Pull** (`git.pull`)
   - Description: "Pull the latest changes from the remote repository."
   - Prompt: `PULL_CHANGES_PROMPT` (handles stash, pull, merge conflicts, restoration)

2. **Push** (`git.push`)
   - Description: "Stage, commit, and push the current changes."
   - Prompt: `PUSH_CHANGES_PROMPT` (stage, commit message, push with upstream setup)

3. **Create PR** (`git.create-pr`)
   - Description: "Push the current branch and open a pull request via gh."
   - Prompt: `CREATE_PR_PROMPT` (git diff, commit, push, gh pr create, checkout main)

---

## 5. Filesystem Templates

**Hook**: `apps/web/src/hooks/use-vibekick-templates.ts`

#### FsTemplate Type:
```typescript
id: string                // unique identifier
location: string          // full path to .md file
name: string             // display name from frontmatter
description: string      // optional frontmatter field
prompt: string           // template body (markdown)
enabled: boolean         // frontmatter flag
init: boolean            // frontmatter flag (pre-checked in picker)
slash: boolean           // frontmatter flag (slash command)
order: number            // yaml ordering key
workspaceRoot: string    // workspace root dir containing this template
scope: string            // relative path scope for visibility filtering
```

#### API Endpoints:
- **GET `/api/vibekick-templates`** — list all filesystem templates
- **GET `/api/vibekick-templates?directory=<path>`** — scoped to directory
- **POST `/api/vibekick-templates`** — create/update template
- **DELETE `/api/vibekick-templates?location=<path>`** — delete template

#### SWR Hooks:
- `useAllFsTemplates()` — returns `{ data: { workspaces, templates }, isLoading, isValidating, error }`
- `useFsTemplatesForDirectory(dir)` — scoped to a specific directory
- `writeFsTemplate(template)` — POST mutation
- `deleteFsTemplate(location)` — DELETE mutation
- `templateBasenameForName(name)` — slugify helper

---

## 6. localStorage + API Surface

### localStorage Keys
- **`"opencode-tools"`** — Zustand persist middleware key for entire ToolsState
  - Contains: `disabledIds`, `burgerHiddenIds`, `systemOverrides`, `customTools`, `projectInitOrder`, `slashCommandIds`

### API Routes
**No dedicated API routes for tools/templates state** (everything is localStorage + filesystem-based via vibekick-templates).

File-based templates use:
- `/api/vibekick-templates` (GET, POST, DELETE)
- No server-side persistence of flags (Burger/Init/Slash/Disable) — all client-side Zustand

---

## 7. AI_TODO Entries (Relevant)

### Completed Themes (landed):
- Settings tabs structure (8-tab split including Templates)
- Auto-approve permissions (separate setting)
- Notifications (Section J)
- File browser (Files tab between Chat and Templates)
- Diagnostics tab

### Pending/Deferred:
- **Templates redesign** — filesystem support, UI polish
- **Init template ordering** — drag-reorder on Init-marked rows
- **Slash command management** — visibility in composers
- **Stock template customization** — system tool overrides (edit/reset)

No explicit AI_TODO entry for "UnifiedToolList component" or "missing FsTemplateRow/NewFsTemplateForm" — these are implementation gaps introduced during refactor.

---

## 8. UnifiedToolList ReferenceError — Root Cause Analysis

### The Bug
**File**: `apps/web/src/components/tools-settings.tsx:748`
```tsx
<UnifiedToolList tools={tools} />
```

**Error**: `ReferenceError: UnifiedToolList is not defined`

### Root Cause
1. **Never imported**: No `import { UnifiedToolList } from ...` statement anywhere
2. **Never defined**: No `function UnifiedToolList() { ... }` in tools-settings.tsx or any other file
3. **Not in the codebase**: `grep -r "UnifiedToolList" apps/web/src` returns zero matches (except the call site)

### Why It Exists
The component is clearly intended to wrap the two tool section groups (system + custom tools). The intended structure should be:
```tsx
<UnifiedToolList tools={tools}>
  {tools
    .filter(t => t.kind === "system")
    .map(tool => (
      <SystemToolRow key={tool.id} tool={tool} ... />
    ))}
  {tools
    .filter(t => t.kind === "custom")
    .map(tool => (
      <CustomToolRow key={tool.id} tool={tool} ... />
    ))}
</UnifiedToolList>
```

Or simpler: render both row types inline without a wrapper, delete the `<UnifiedToolList>` call entirely.

### Related Bugs in Same File
1. **`AddCustomTool` incomplete** (lines 470-568):
   - References 8 undefined variables: `burger`, `setBurger`, `init`, `setInit`, `slash`, `setSlash`, `onClose`, `saving`, `submit`, `error`
   - Should declare state hooks and handlers

2. **Missing components**:
   - `FsTemplateRow` — referenced line 681, not defined
   - `NewFsTemplateForm` — referenced line 697, not defined

---

## 9. Summary of Findings

| Category | Finding |
|----------|---------|
| **Settings Tab** | Renamed "tools" → "templates"; hash redirect in place; TabPanel id="templates" exists |
| **Component Status** | `ToolsSettings` exported + renders, but calls undefined `<UnifiedToolList>` on line 748 → ReferenceError |
| **Defined Components** | `FlagCheckbox`, `SystemToolRow`, `CustomToolRow`, `AddCustomTool` (incomplete), `FsTemplatesSection` (incomplete), `ToolsSettings` |
| **Missing Components** | `UnifiedToolList`, `FsTemplateRow`, `NewFsTemplateForm` |
| **Store** | `useToolsStore` fully defined; 6 persisted fields; 8 action methods; `resolveToolsFromState()` helper |
| **Stock Templates** | 3 shipped: Pull, Push, Create PR (in `prompt-tools.ts`) |
| **Filesystem Templates** | API at `/api/vibekick-templates`; SWR hooks available; FsTemplate type defined |
| **localStorage Key** | `"opencode-tools"` stores all flags/overrides/custom tools |
| **Incomplete Features** | `AddCustomTool` form missing state/handlers; filesystem template UI (FsTemplateRow, NewFsTemplateForm) not implemented |

---

## Next Steps for Redesign

1. **Fix UnifiedToolList ReferenceError**:
   - Delete line 748 call
   - Render `SystemToolRow` + `CustomToolRow` directly in `ToolsSettings`, or define `UnifiedToolList` wrapper

2. **Complete AddCustomTool**:
   - Add state hooks for: `burger`, `init`, `slash`, `saving`, `error`
   - Implement `submit()` handler that calls `upsertCustomTool()`
   - Implement `onClose()` to reset form

3. **Implement missing components**:
   - `FsTemplateRow`: render filesystem template with edit/toggle/delete
   - `NewFsTemplateForm`: create new template modal with workspace + path selection

4. **Templates redesign doc** can proceed once these bugs are fixed.

