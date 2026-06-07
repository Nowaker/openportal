---
name: OPENCODE_WEB_LINK_INTEGRATION
description: Hamburger menu implementation, link-opening conventions, session/server context, and external opener patterns for "Open in OpenCode Web" feature
type: reference
---

# OpenCode Web Link Integration — Discovery Report

## Goal
Add a "hamburger > Open in OpenCode Web" action that uses an optional per-server web endpoint URL to open the current session in OpenCode's regular UI.

## Key Findings

### 1. Hamburger Menu Implementation

**File**: `/home/nowaker/projekty/webapps/portal/apps/web/src/components/app-sidebar-nav.tsx`

**Menu Structure** (lines 963-1149):
```tsx
<Menu isOpen={menuOpen} onOpenChange={setMenuOpen}>
  <MenuTrigger aria-label="Open menu">
    <Button intent="outline" size="sq-sm">
      <EllipsisVerticalIcon className="size-4" />
    </Button>
  </MenuTrigger>
  <MenuContent placement="bottom end" className="min-w-56">
    <MenuSection>
      {/* Top-level items: Prompt history, Pinned messages, File browser, System messages */}
    </MenuSection>
    {sessionId && <MenuSeparator />}
    {sessionId && (
      <MenuSection>
        {/* Session-scoped items */}
      </MenuSection>
    )}
  </MenuContent>
</Menu>
```

**Components Used** (from `ui/menu.tsx`):
- `Menu` - wrapper/trigger container
- `MenuTrigger` - the button that opens the menu
- `MenuContent` - the popover dropdown
- `MenuItem` - individual action items
- `MenuSection` - logical grouping with optional separators
- `MenuSeparator` - divider between sections

### 2. Insertion Point for New Action

**Location**: `app-sidebar-nav.tsx:1059-1070` (between "Open in VS Code" and "Compact session")

**Current code block** (the "Open in VS Code" item):
```tsx
{currentSession?.directory && (
  <MenuItem
    onAction={() => openInVscode(currentSession.directory)}
    data-test="portal-hamburger-open-vscode"
  >
    <CodeBracketIcon className="size-4" data-slot="icon" />
    Open in VS Code
  </MenuItem>
)}
```

**Recommended insertion point**: Immediately after line 1070 (after the closing `)}` of the VSCode block). The "Open in OpenCode Web" item should:
- Be in the same `MenuSection` as session-scoped items (already wrapped by the `{sessionId && (...)}`guard)
- Use the same visual pattern: icon + label
- Use `MenuItem` with `onAction` callback
- Add a `data-test` attribute for QA

### 3. Link Opening Conventions

**Pattern 1 — VSCode (window.location.href)**
File: `vscode-link.tsx:46, 98-100`
```tsx
window.location.href = buildVscodeHref(absPath);

function buildVscodeHref(absPath: string): string {
  return `vscode://file${encodeURI(absPath.replace(/\/+$/, ""))}/`;
}
```

**Pattern 2 — Export (target=_blank anchor)**
File: `app-sidebar-nav.tsx:914-924`
```tsx
<a
  href={`/api/opencode/${port}/session/${encodeURIComponent(sessionId)}/export`}
  target="_blank"
  rel="noopener noreferrer"
  aria-label="Export session as Markdown"
  title="Download full chat as Markdown"
  data-test="portal-titlebar-export"
  className="shrink-0 inline-flex items-center justify-center rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
>
  <ArrowDownTrayIcon className="size-4" />
</a>
```

**Recommended for OpenCode Web link**: Use `window.open()` with the webEndpoint URL, since:
- The target is an external web URL (not a protocol handler like `vscode://`)
- Opening in the same tab via `window.location.href` would abandon the Portal session
- Opening in a new tab via `target="_blank"` is appropriate for linking to OpenCode UI

### 4. Session Context Availability

**Current Session ID and Port** (from route params):
```tsx
// File: app-sidebar-nav.tsx:187 (AppSidebarNav function signature)
// Inside the function:
const sessionId = useMatch({
  from: "/_app/session/$id",
  select: (match) => match.params.id ?? null,
});
const port = useInstanceStore((s) => s.instance?.port ?? null);
const currentSession = ... // from SWR fetch of session details
```

**Access pattern in menu handler**:
```tsx
onAction={() => {
  if (!port || !sessionId) return;
  // Handle the action with sessionId and port
}}
```

### 5. Server Configuration — WebEndpoint URL

**Available Server Instance Data**:
```tsx
// From: useInstanceStore (stores/instance-store.ts:4-9)
export interface Instance {
  id: string;
  name: string;
  port: number;
  hostname?: string;
}

// From: useSelfInstance() (hooks/use-opencode.ts:95-101)
export interface SelfInstance {
  id: string;
  name: string;
  directory: string;
  port: number;
  hostname: string;
}
```

**Current limitation**: Neither `Instance` nor `SelfInstance` includes a `webUrl` or `webEndpoint` field. 

**Options to obtain the webEndpoint**:
1. **Extend `SelfInstance`** to include an optional `webUrl` field from OpenCode's `/config/providers` response (requires server-side changes)
2. **Fetch from OpenCode** at runtime via `useConfig()` hook (see `use-opencode.ts:285`), which returns provider/model configuration
3. **Store in OpenPortal config** alongside the instance registry (like VSCode mappings are stored in `~/.openportal/openportal-vscode-mappings.json`)
4. **Use hostname inference** (e.g., if the instance name contains a URL pattern, extract it)

### 6. UI Component Rules (from AGENTS.md)

**Native HTML widgets** (FORBIDDEN):
- ❌ `window.alert`, `window.confirm`, `window.prompt`
- ❌ Bare `<select>` / `<option>` dropdowns
- ❌ Bare `<input type="file">`
- ✅ Use project's visual framework components instead

**Form field fonts** (MANDATORY):
- ❌ Monospace on free-form text fields (prompts, descriptions, chat)
- ✅ Monospace on code-shaped content (paths, URLs, hostnames, JSON, commands)

**Text selection** (MANDATORY):
- ❌ Never add `select-none` or `user-select: none` to text content
- Text must be copy-pastable

**Loading feedback** (MANDATORY):
- ✅ Show `<Loader />` spinner while fetching webUrl
- ✅ Disable the menu item if the URL is not yet available

**Async-action feedback** (MANDATORY):
- ✅ Disable the menu item or show loading state while opening
- ✅ Surface errors via toast notification if `window.open()` fails

### 7. Existing External Opener Helpers

**VSCode Opener Hook** (vscode-link.tsx:33-78):
```tsx
export function useVscodeOpener(): {
  ready: boolean;
  open: (directory: string) => void;
  modalElement: React.ReactNode;
}
```
Used in: `app-sidebar-nav.tsx:79` (imported as `useVscodeOpener`)
Called in: `app-sidebar-nav.tsx:1061` (line `openInVscode(currentSession.directory)`)

**Pattern**: The hook returns a `ready` flag (loading state) and an `open` function. The modal handles path mapping for remote contexts.

### 8. Data-Test Naming Convention

Existing patterns in hamburger menu:
- `data-test="portal-hamburger-system-messages"` (line 1029)
- `data-test="portal-hamburger-open-vscode"` (line 1062)
- `data-test="portal-hamburger-clean-session"` (line 1095)
- `data-test="portal-hamburger-stuck-fix"` (line 1102)
- `data-test="portal-hamburger-archive"` / `portal-hamburger-unarchive"` (line 1114)
- `data-test="portal-hamburger-move"` (line 1122)

**Recommendation**: `data-test="portal-hamburger-open-in-opencode"`

### 9. Session Action Store (Title Bar Placement)

File: `stores/title-bar-actions-store.ts:1-44`

Current actions registered:
```tsx
export const SESSION_ACTIONS = [
  {
    id: "compact",
    label: "Compact session",
    description: "AI-summarise older history...",
  },
  {
    id: "export",
    label: "Export markdown",
    description: "Quick links that download...",
  },
] as const;
```

**If the feature should support title-bar placement** (optional "both" mode):
- Add a new action entry to `SESSION_ACTIONS` array
- Define placement defaults in the `DEFAULTS` record
- The settings UI (`settings.tsx:1004-1027`) will auto-generate the placement toggle for the new action
- Render title-bar shortcut button in `app-sidebar-nav.tsx` alongside the hamburger entry

---

## Implementation Checklist

- [ ] **Determine webUrl source**: Decide how the per-server web endpoint URL will be fetched/stored
  - Option: Extend `SelfInstance` to include optional `webUrl` from OpenCode's `/config/providers`
  - Option: Create a new hook `useServerWebUrl()` that fetches from OpenCode config
  
- [ ] **Create MenuItem handler** in `app-sidebar-nav.tsx:1071`:
  - Guard: check `sessionId && port && webUrl`
  - Call: `window.open(webUrl + '/session/' + sessionId, '_blank')`
  - Error handling: show toast on failure
  
- [ ] **Optional: Add to SESSION_ACTIONS** if title-bar placement should be configurable
  - Register in `title-bar-actions-store.ts`
  - Render title-bar button alongside hamburger entry
  
- [ ] **Icon choice**: Recommend `GlobeAltIcon` or `ArrowTopRightOnSquareIcon` from `@heroicons/react/24/outline`

- [ ] **Test attributes**: Add `data-test="portal-hamburger-open-in-opencode"`

- [ ] **UI rules compliance**:
  - [ ] Loading feedback while fetching webUrl
  - [ ] Disabled state if URL unavailable
  - [ ] Error toast on `window.open()` failure

