# New Session Flow - Complete Architecture Map

## Overview
The new-session page (`/session/new?directory=...`) allows users to:
1. Select init templates (currently shows ALL tools, including disabled ones — **BUG**)
2. Compose a first prompt
3. Create a session and send the prompt to OpenCode

Current behavior: template content is concatenated into the textarea on check, then submitted as plain text.

Desired behavior: templates stay OUT of the visible textarea, prepend on submit, and record as "/template Full name" lines in history.

---

## File Locations (Absolute Paths)

### Route & UI
- **New Session Route**: `/home/nowaker/projekty/webapps/portal/apps/web/src/routes/_app/session/new.tsx`
  - Lines 92-1094: Full NewSessionPage component
  - Lines 663-765: Template picker UI (the bug is here)
  - Lines 172-176: `composedAutoPrompt` derivation (templates concatenated into textarea)

### Template Storage & State
- **Tools Store**: `/home/nowaker/projekty/webapps/portal/apps/web/src/stores/tools-store.ts`
  - Lines 59-81: `resolveToolsFromState()` — merges system + custom tools with disabled flags
  - Lines 156-163: `toggleProjectInit()` — marks tools as init templates
  - Lines 165-170: `reorderProjectInit()` — drag-reorder init templates
  - **Key field**: `projectInitOrder: string[]` — ordered list of init template IDs

- **System Tools**: `/home/nowaker/projekty/webapps/portal/apps/web/src/lib/prompt-tools.ts`
  - Lines 72-91: `SYSTEM_TOOLS` array (currently 3 tools: Pull, Push, Create PR)
  - Each tool has `id`, `name`, `description`, `prompt` fields

### Submission & Dispatch
- **Session Create Endpoint**: `/home/nowaker/projekty/webapps/portal/apps/web/src/server/opencode/[port]/session/create.ts`
  - Lines 6-10: Schema accepts `directory` as query param
  - Lines 17-20: Passes directory to opencode's `session.create()`

- **Prompt Submit Endpoint**: `/home/nowaker/projekty/webapps/portal/apps/web/src/server/opencode/[port]/session/[id]/prompt.ts`
  - Lines 131-144: `archivePrompt()` call with `source: "prompt"`
  - Lines 97-103: Payload construction (text + attachments + model/agent/variant)
  - **Key**: No template handling here — raw text is archived as-is

- **Command Submit Endpoint**: `/home/nowaker/projekty/webapps/portal/apps/web/src/server/opencode/[port]/session/[id]/command.ts`
  - Lines 46-48: Reconstructs `/command arguments` for archive
  - Lines 54-67: Archives with `source: "command"`
  - **Note**: Slash commands are routed separately from plain prompts

### Prompt Archive & History
- **Archive Module**: `/home/nowaker/projekty/webapps/portal/apps/web/src/server/lib/prompt-archive.ts`
  - Lines 9-27: `ArchiveInput` interface — what gets archived
  - Lines 36-58: `PromptRow` schema (SQLite table shape)
  - Lines 160-237: `archivePrompt()` function
    - Calls `filterPrompt()` to strip OMO/system noise
    - Fetches session metadata (directory, parentID) from opencode
    - Inserts row with `raw_text` (filtered) + `raw_text_unfiltered`
    - **Key fields**: `source: "prompt" | "command"`, `attachments_count`, `opencode_message_id`

- **Prompt Filter**: `/home/nowaker/projekty/webapps/portal/apps/web/src/server/lib/prompt-filter.ts`
  - Lines 172-185: `filterPrompt()` — strips OMO directives, redacts credentials
  - Returns `{ shouldArchive, filtered, unfiltered }`
  - **Note**: Does NOT handle template expansion — that's the caller's job

- **Pending Prompts (Client-side Durability)**: `/home/nowaker/projekty/webapps/portal/apps/web/src/lib/pending-prompts.ts`
  - Lines 36-51: `PendingPromptEntry` interface
  - Lines 104-120: `recordPendingSubmission()` — writes to localStorage BEFORE fetch
  - Lines 122-127: `clearPendingSubmission()` — removes after server 202
  - **Key fields**: `kind: "prompt" | "command"`, `commandName`, `commandArguments`

- **Pending Prompt Worker**: `/home/nowaker/projekty/webapps/portal/apps/web/src/server/plugins/pending-prompt-worker.ts`
  - Lines 48-105: `deliverOne()` — retries pending rows with exponential backoff
  - Lines 93-99: Calls `client.session.promptAsync()` with payload from `payload_json`
  - **Note**: Worker is fire-and-forget; no template handling here either

### Slash Commands
- **Slash Command Popover**: `/home/nowaker/projekty/webapps/portal/apps/web/src/components/slash-command-popover.tsx`
  - Lines 21-28: `useCommands()` hook — fetches `/api/opencode/{port}/command`
  - Lines 116-144: `SlashCommandPopover` component
  - **Modes**: "command" (default), "agent", "model"
  - **Note**: Slash commands exist and are fully integrated

- **Slash Command Detection in new.tsx**: Lines 355-374
  - Detects `/command arguments` pattern
  - Routes to `/api/opencode/{port}/session/{id}/command` instead of `/prompt`
  - Archives with `kind: "command"` + `commandName` + `commandArguments`

---

## Current Flow (Step-by-Step)

### 1. User Checks Template Checkbox
- **File**: `new.tsx` lines 147-154
- **Handler**: `toggle(id)` updates `selected` Set
- **Effect**: Lines 290-295 — if no user edit and no draft, `setText(composedAutoPrompt)`
  - `composedAutoPrompt` (lines 172-176) joins checked templates with `\n\n---\n\n`
  - Textarea now shows concatenated template content

### 2. User Types Additional Prompt
- **File**: `new.tsx` lines 966-985
- **Handler**: `onChange` updates `text` state + schedules draft save
- **Result**: Textarea contains `[template1 content]\n\n---\n\n[template2 content]\n\n[user text]`

### 3. User Clicks Submit
- **File**: `new.tsx` lines 325-486
- **Handler**: `handleSubmit()`
  - Line 344: Creates session with `createSession({ directory })`
  - Lines 348-353: Resolves default agent/model/thinking
  - Lines 363-374: Detects slash commands (if text starts with `/`)
  - Lines 378-389: Records pending submission to localStorage
  - Lines 392-425: POSTs to `/api/opencode/{port}/session/{id}/prompt` or `/command`
    - **Payload**: `{ text: message, attachments?, model?, agent?, variant? }`
    - **Note**: `message` is the full textarea content (templates + user text)

### 4. Server Archives Prompt
- **File**: `prompt.ts` lines 131-144
- **Handler**: `archivePrompt()`
  - `rawText: body.text` — the full concatenated string
  - `source: "prompt"`
  - Calls `filterPrompt()` to strip noise
  - Inserts into SQLite `prompts` table
  - **Result**: Archive row has `raw_text` = "[template1]\n\n---\n\n[template2]\n\n[user text]"

### 5. Worker Delivers to OpenCode
- **File**: `pending-prompt-worker.ts` lines 48-105
- **Handler**: `deliverOne()`
  - Reads `payload_json` from archive row
  - Calls `client.session.promptAsync()` with payload
  - OpenCode receives the full concatenated text as a single user message

### 6. Prompt History Shows
- **Archive**: Raw text is `[template1]\n\n---\n\n[template2]\n\n[user text]`
- **No distinction** between template content and user content
- **User can't tell** which parts came from templates vs. their own typing

---

## The Bug: Disabled Templates Show

**Location**: `new.tsx` lines 712-762 (template picker loop)

```tsx
{order.map((tool) => {
  const isDragOver = dragOverId === tool.id;
  const isSelected = selected.has(tool.id);
  return (
    <div key={tool.id} ...>
      ...
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => toggle(tool.id)}
      />
      <span>{tool.name}</span>
      {!tool.enabled && (
        <span className="text-[10px] uppercase tracking-wide text-muted-fg shrink-0">
          disabled
        </span>
      )}
    </div>
  );
})}
```

**Problem**: The loop renders ALL tools in `order`, regardless of `tool.enabled`. A disabled tool shows with a "disabled" label but is still clickable and selectable.

**Root Cause**: `order` is derived from `initialOrder` (lines 125-134), which includes all tools. The filter `!initSet.has(t.id)` only affects ordering, not visibility.

**Fix**: Filter `order` to exclude disabled tools before rendering:
```tsx
{order.filter(t => t.enabled).map((tool) => { ... })}
```

---

## Slash Commands: Fully Integrated

**Yes, slash commands exist and work.**

- **Detection**: `new.tsx` lines 364-374 — regex `/^\/(\S+)\s*([\s\S]*)$/`
- **Validation**: Checks if command name is in `commandsData` (fetched from `/api/opencode/{port}/command`)
- **Dispatch**: Routes to `/api/opencode/{port}/session/{id}/command` instead of `/prompt`
- **Archive**: Records as `kind: "command"` with `commandName` + `commandArguments`
- **Popover**: `SlashCommandPopover` component (lines 912-936) shows autocomplete as user types `/`

**Example**: User types `/pull` → detected as command → archived as `{ kind: "command", commandName: "pull", commandArguments: "" }` → opencode expands the template server-side.

---

## Directory Handling

**Flow**:
1. URL param: `?directory=/path/to/project`
2. `new.tsx` line 94: `const { directory: directoryFromUrl } = Route.useSearch()`
3. Line 107: `const directory = directoryFromUrl || storeDir || null`
4. Line 344: `createSession({ directory })`
5. `use-opencode.ts` line 333: POSTs to `/api/opencode/{port}/session/create`
6. `create.ts` lines 17-20: Passes directory as query param to opencode
   ```ts
   const session = await client.session.create({
     body: { title: body.title, parentID: body.parentID },
     query: body.directory ? { directory: body.directory } : undefined,
   });
   ```
7. OpenCode uses directory to set the session's working directory

**Key**: Directory is passed at session CREATE time, not at prompt time. The session is bound to that directory for its lifetime.

---

## Proposed Changes for Redesign

### 1. Filter Disabled Templates
- **File**: `new.tsx` line 712
- **Change**: `{order.filter(t => t.enabled).map((tool) => { ... })}`

### 2. Keep Templates OUT of Textarea
- **File**: `new.tsx` lines 172-176 (composedAutoPrompt)
- **Change**: Don't auto-populate textarea with template content
- **Instead**: Store selected template IDs separately, prepend on submit

### 3. Prepend Templates on Submit
- **File**: `new.tsx` lines 325-486 (handleSubmit)
- **Change**: Before POSTing, build final message as:
  ```
  /template Template Name 1
  /template Template Name 2
  
  [user's actual prompt text]
  ```
- **Or**: Build as structured data and let opencode expand

### 4. Archive Templates as Slash Commands
- **File**: `new.tsx` lines 363-389 (slash dispatch + archive)
- **Change**: For each selected template, emit a `/template name` line
- **Archive**: Record as multiple command entries or as a single prompt with template markers
- **History**: User sees `/template Pull` + `/template Push` + `my actual prompt`

### 5. Update Prompt Archive Schema (Optional)
- **File**: `prompt-archive.ts` lines 9-27 (ArchiveInput)
- **Consider**: Add `templates?: string[]` field to track which templates were prepended
- **Benefit**: History UI can render templates distinctly (different styling, collapsible)

---

## Key Invariants to Preserve

1. **Directory immutability**: Once a session is created with a directory, it's fixed for the session's lifetime.
2. **Prompt durability**: Every prompt must be archived to SQLite before returning 202 to the browser.
3. **Slash command routing**: `/command` endpoint must be used for template expansion, not `/prompt`.
4. **Pending prompt worker**: Must handle retries with backoff indefinitely (no retry limit).
5. **Cross-tab sync**: Composer drafts sync via BroadcastChannel; template selection should too (if persisted).

---

## Testing Checklist

- [ ] Disabled templates do NOT appear in the picker
- [ ] Enabled templates appear and are selectable
- [ ] Drag-reorder works for enabled templates only
- [ ] Textarea does NOT auto-populate with template content
- [ ] On submit, templates are prepended as `/template Name` lines
- [ ] History shows `/template Name` lines + user prompt
- [ ] Slash command detection still works (e.g., `/pull` typed by user)
- [ ] Directory param flows through to session creation
- [ ] Pending prompts survive openportal restart
- [ ] Cross-tab composer sync still works

