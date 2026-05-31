# Templates Data Model & .vibekick Schema — Comprehensive Analysis

## 1. Current Data Model & Storage Map

### 1.1 Portal-State Namespace Pattern
**Source**: `apps/web/src/server/lib/portal-state.ts`

The settings pattern is simple:
```typescript
export function getSettings(): Record<string, unknown>
export function setSetting(namespace: string, value: unknown): Record<string, unknown>
```

Persists to `~/.openportal-state.json` with structure:
```json
{
  "settings": {
    "<namespace>": <value>,
    "<namespace>": <value>
  }
}
```

**Key insight**: Each feature wraps these into typed helpers. Current usage:
- `settings.autoApprove` — auto-approve state
- `settings.instance` — tool output byte cap and other instance settings

### 1.2 Tools/Templates Persistence (THREE independent layers)

**LAYER 1: Browser localStorage (Zustand persist middleware)**
- **Key**: `"opencode-tools"` (hardcoded in tools-store.ts:254)
- **Persisted fields** (tools-store.ts:31-76):
  ```typescript
  interface ToolsPersistedState {
    disabledIds: string[];           // fully disabled (kill switch)
    burgerHiddenIds: string[];       // hidden from topbar burger ONLY
    systemOverrides: Record<string, { name?, prompt? }>;  // user edits to SYSTEM_TOOLS
    customTools: CustomTool[];       // user-created tools
    projectInitOrder: string[];      // ordered template ids for new-session prepend
    slashCommandIds: string[];       // set of templates with /template registration
  }
  ```
- **CustomTool shape**:
  ```typescript
  interface CustomTool {
    id: string;        // arbitrary user-chosen id
    name: string;
    description?: string;
    prompt: string;    // full prompt body (no frontmatter)
  }
  ```

**LAYER 2: Portal-State (server-side, for future global defaults)**
- Currently unused but available for global defaults (if templates become server-wide)
- Namespace would be: `settings.templates` (proposed, not yet used)

**LAYER 3: Filesystem (.vibekick/templates/*.md, per-project)**
- Already fully implemented
- YAML frontmatter + markdown body
- Scoped to workspace roots from `~/.openportal/openportal.json`

### 1.3 Template Resolution (merged list)

**Source**: `apps/web/src/stores/tools-store.ts:98-147`

```typescript
export function resolveToolsFromState(state: ToolsPersistedState): ResolvedTool[] {
  // Returns union of system + custom + filesystem templates,
  // with flags resolved from the three layers:
  return [
    ...SYSTEM_TOOLS.map(t => ({
      ...t,
      kind: "system",
      name: systemOverrides[t.id]?.name ?? t.name,
      prompt: systemOverrides[t.id]?.prompt ?? t.prompt,
      isInBurger: !burgerHidden.has(t.id),
      isDisabled: disabled.has(t.id),
      isInit: projectInitOrder.has(t.id),
      isSlash: slashCommands.has(t.id),
      isOverridden: systemOverrides[t.id] !== undefined,
    })),
    ...customTools.map(t => ({ ...t, kind: "custom", ... })),
    // filesystem templates would be added here in the merged list
  ];
}
```

---

## 2. Stock Template List (Verbatim)

**Source**: `apps/web/src/lib/prompt-tools.ts:72-91`

Three system templates, immutable (stored in code):

1. **git.pull** — "Pull"
   - Description: "Pull the latest changes from the remote repository."
   - Steps: check git status, stash uncommitted changes, git pull, pop stash if needed, show summary

2. **git.push** — "Push"
   - Description: "Stage, commit, and push the current changes."
   - Steps: check git status, stage changes, commit with meaningful message, push (setting upstream if needed), show summary

3. **git.create-pr** — "Create PR"
   - Description: "Push the current branch and open a pull request via gh."
   - Steps: check status, stage, get diff, commit, push, create PR with gh CLI, checkout main

---

## 3. Filesystem & Workspace Helpers (Already Implemented)

**Source**: `apps/web/src/server/lib/vibekick-templates.ts` (385 lines)

### 3.1 Workspace Root Resolution
```typescript
export function resolveWorkspaceRoot(
  directory: string,
  workspaceRoots: string[]
): string {
  // Walks UP from directory to find the longest-matching configured workspace root.
  // Falls back to directory itself if no match.
  // Example: given directory=/home/nowaker/projekty/portal/src
  //          and workspaceRoots=["~/projekty"]
  //          returns: /home/nowaker/projekty
}
```

### 3.2 Filesystem Template Discovery
```typescript
// Walk upward from a session's directory to its workspace root,
// collecting all .vibekick/templates/*.md files
export function templatesForDirectory(
  directory: string,
  workspaceRoot: string
): FsTemplate[] {
  // Closest-to-leaf appears first (directory overrides parents)
  // Within one level, sorted by YAML "order" field
}

// Scan entire workspace tree recursively
export function scanWorkspaceTemplates(workspaceRoot: string): FsTemplate[] {
  // Used by Settings UI to show ALL templates under the workspace
}
```

### 3.3 Path Validation
```typescript
export function validateTemplateLocation(
  location: string,
  workspaceRoots: string[]
): { ok: true; workspaceRoot: string } | { ok: false; reason: string } {
  // Ensures: .md extension, lives under /.vibekick/templates/,
  // is inside a configured workspace root
}
```

---

## 4. YAML Frontmatter Parsing (Custom, Not gray-matter)

**Source**: `apps/web/src/server/lib/vibekick-templates.ts:70-148`

### 4.1 No External Dependency
- Codebase does NOT use `gray-matter` or any frontmatter library
- Custom minimal parser written specifically for the fixed schema
- `gray-matter` exists only as a transitive dependency (eslint → gray-matter), NOT used by portal

### 4.2 Parser Implementation
```typescript
// Regex extracts frontmatter block and body
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// Custom YAML key:value parser (scalar lines only)
function parseFrontmatter(yaml: string): Record<string, string | boolean | number> {
  // Handles: name, description (string), enabled/init/slash (boolean), order (number)
  // Tolerates comments (#), blank lines, malformed lines (ignores them)
  // Returns typed object with coercion: "true" -> true, "42" -> 42, quoted strings unquoted
}

// Inverse: serialize FsTemplateInput to YAML + body
function serializeFrontmatter(t: FsTemplateInput): string {
  // Generates: ---\nname: ...\n...\n---\n<body>
  // Escapes YAML-sensitive chars in string values
}
```

---

## 5. Proposed .vibekick/templates Schema & Merge Algorithm

### 5.1 File Format

```markdown
---
name: My Template Name
description: Optional one-liner about what this template does
enabled: true
init: false
slash: true
order: 100
---

This is the prompt body. It can contain any markdown you like.
Multiple paragraphs, code blocks, etc.

When submitted, the body (without frontmatter) is sent to opencode.
```

### 5.2 FsTemplate Interface (Already in codebase)

```typescript
export interface FsTemplate {
  id: string;              // "fs:<absolute-path>" (stable id)
  name: string;            // from frontmatter or derived from filename
  description?: string;    // from frontmatter
  enabled: boolean;        // from frontmatter, defaults to true
  init: boolean;           // from frontmatter, defaults to false
  slash: boolean;          // from frontmatter, defaults to false
  order: number;           // from frontmatter, defaults to 0 (for sorting within one level)
  prompt: string;          // body after frontmatter strip
  location: string;        // absolute path to .md file
  workspaceRoot: string;   // resolved workspace root
  scope: string;           // path relative to workspace root (e.g., "subdir/.vibekick/templates/foo.md")
}
```

### 5.3 Merge Algorithm: Global + Filesystem Templates into One List

**For the Settings UI** (shows all templates, all levels):
```
ResolvedTemplate[] = merge(
  systemTemplates (stock: Pull, Push, Create PR),
  customTemplates (from localStorage),
  filesystemTemplates (from scanWorkspaceTemplates)
)

Grouped by section:
  1. System templates (Pull, Push, Create PR)
  2. Your templates - global (custom tools from localStorage)
  3. Your templates - filesystem (fs-backed .vibekick templates, grouped by scope/workspace)

Per-row flags:
  - Burger: controls visibility in topbar menu
  - Disable: kill-switch (hides everywhere)
  - Init: pre-checked in new-session picker, concatenated on submit
  - Slash: /template autocomplete registration
```

**For the new-session picker** (shows only non-disabled, all three sources):
```
Templates shown = all(enabled=true && disabled=false)
Pre-checked = those in projectInitOrder (filtered to only non-disabled)
On submit, concatenate bodies in projectInitOrder sequence
```

**For slash autocomplete**:
```
Autocomplete entries = all(enabled=true && disabled=false && slash=true)
Filtered by !disabled (Burger flag does NOT affect slash visibility)
```

### 5.4 Init Order Across Filesystem Templates

**Problem**: When a filesystem template is reordered relative to another (in Settings UI), where does the ordering persist?

**Solution**: Within the filesystem layer, the YAML `order` field in each template's frontmatter is the source of truth. When the user drag-reorders filesystem templates in Settings, the UI writes back new `order` values to each affected `.md` file.

For the merged global+filesystem list, there are TWO parallel orderings:
1. **Filesystem-internal ordering**: `order` field in each .md file's frontmatter
2. **Global init ordering**: `projectInitOrder` in localStorage, which can interleave both layers

When submitting a new session:
- Walk `projectInitOrder` array (which has BOTH global custom tool ids and fs template ids)
- For each id, find the corresponding template (custom or fs)
- Concatenate bodies in that order

---

## 6. Tools → Templates Rename: Migration Plan

### 6.1 Current State
- **localStorage key**: `"opencode-tools"` (defined in tools-store.ts:254)
- **Zustand store**: `useToolsStore` (exported from tools-store.ts:156)
- **Custom tool interface**: `CustomTool`
- **System constant**: `SYSTEM_TOOLS`

### 6.2 Migration Strategy

#### Phase 1: Dual-write (backward-compat shim)
- Keep writing to `"opencode-tools"` in localStorage indefinitely
- Do NOT rename the key (breaks existing user data)
- Instead, rename the Zustand store export: `useToolsStore` → `useTemplatesStore`
- Rename the interface: `CustomTool` → `CustomTemplate`
- Rename system constant: `SYSTEM_TOOLS` → `SYSTEM_TEMPLATES`
- Reason: localStorage key is a contract with user data; renaming it would silently wipe existing custom tools

#### Phase 2: Deprecation in comments
- Add a comment above the Zustand creation (tools-store.ts:254):
  ```typescript
  {
    name: "opencode-tools",
    // MIGRATION NOTE: localStorage key stays "opencode-tools" for backward
    // compatibility. Existing user custom tools must survive. The Zustand
    // store and all exported interfaces were renamed to use "templates"
    // terminology (useTemplatesStore, CustomTemplate, SYSTEM_TEMPLATES).
    // The file itself (tools-store.ts) was NOT renamed to avoid git history
    // churn on a file that rarely changes post-migration.
  ```

#### Phase 3: Portal-state (server-side future defaults)
- When/if global template defaults move to `~/.openportal-state.json`, use:
  ```typescript
  settings.templates = {
    customTemplates: CustomTemplate[],
    projectInitOrder: string[],
    slashCommandIds: string[]
  }
  ```
- No collision with localStorage (different storages, different namespace)

### 6.3 Every Persisted Key That Needs a Shim
| Zustand state slice | localStorage key under "opencode-tools" | Migration path |
|---|---|---|
| `disabledIds` | `.disabledIds` | No change — keep as-is |
| `burgerHiddenIds` | `.burgerHiddenIds` | No change — keep as-is |
| `systemOverrides` | `.systemOverrides` | No change — keep as-is |
| `customTools` | `.customTools` | No change — keep as-is |
| `projectInitOrder` | `.projectInitOrder` | No change — keep as-is |
| `slashCommandIds` | `.slashCommandIds` | No change — keep as-is |

**Key insight**: The data schema stays identical; only the terminology in comments and exports changes. No data migration required.

### 6.4 Files to Touch
1. **apps/web/src/stores/tools-store.ts**
   - Rename: `useToolsStore` → `useTemplatesStore`
   - Rename: `CustomTool` → `CustomTemplate` (type alias: `type CustomTool = CustomTemplate` for compat)
   - Add migration note comment at line 254

2. **apps/web/src/lib/prompt-tools.ts**
   - Rename: `SYSTEM_TOOLS` → `SYSTEM_TEMPLATES` (export both, mark old as deprecated)

3. **apps/web/src/components/tools-settings.tsx**
   - Update imports and variable names
   - Update UI labels: "Tools" → "Templates", "Custom tools" → "Your templates - global"

4. **apps/web/src/routes/_app/session/new.tsx**
   - Update imports

5. **All other files that import from tools-store**
   - Search: `useToolsStore`, `CustomTool`, `SYSTEM_TOOLS`
   - Update to new names or provide compat exports

### 6.5 Compat Exports (Optional, for safety)
In tools-store.ts, after the rename:
```typescript
// Deprecated: use useTemplatesStore instead
export const useToolsStore = useTemplatesStore;
```

In prompt-tools.ts, after renaming SYSTEM_TEMPLATES:
```typescript
export const SYSTEM_TOOLS = SYSTEM_TEMPLATES;
```

This allows a gradual rollout without breaking all imports at once.

---

## 7. Downstream Synthesis: Data Model + Persistence Section

### Summary for Design Docs

**Three-layer persistence model**:

1. **Stock templates** (code) — Pull, Push, Create PR defined in `apps/web/src/lib/prompt-tools.ts`, immutable
2. **Custom global templates** (localStorage) — `opencode-tools` key, Zustand-managed, CustomTemplate interface
3. **Project-local filesystem templates** — `.vibekick/templates/*.md` with YAML frontmatter, workspace-scoped

**Merged list** for UI rendering includes all three, with per-template flags:
- **Burger**: topbar menu visibility
- **Disable**: kill-switch (hides everywhere)
- **Init**: pre-checked on new-session, concatenated on submit
- **Slash**: /template autocomplete registration

**Init ordering** is global (`projectInitOrder` in localStorage), persists across global and filesystem templates.

**Filesystem template ordering** within one directory level uses YAML `order` field; drag-reorder in Settings writes back new `order` values to affected `.md` files.

---

## Appendix: AI_TODO Entries (Complete)

### #112 — Templates redesign (PENDING on feat/templates-redesign)
Settings tab UX, new-session prepend-on-submit, per-project .vibekick/templates/*.md, slash command integration

### #125 — Templates rename + three Your-templates sections (PENDING on feat/templates-redesign)
Rename "Tools" → "Templates" everywhere; organize into: System templates, Your templates - global, Your templates - filesystem

### #126 — Burger/Disable/Init semantics (PENDING on feat/templates-redesign)
Rename "On" → "Burger", separate Disable from Burger, new-session shows all non-disabled regardless of init flag, slash filter ignores Burger
