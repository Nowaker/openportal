# Composer Slash Autocomplete Wiring

## Summary

OpenPortal's slash-command autocomplete is a two-part system:
1. **Popover UI** (SlashCommandPopover): Renders filtered command list at caret position with keyboard navigation
2. **Hook state machine** (useSlashCommand): Detects `/` tokens, manages mode/query, handles text substitution

Template entries are injected as synthetic slash-command items alongside opencode commands. Selection triggers in-place body expansion via `expandTemplateAtSlash()`, which pads the inserted text to 2 newlines before/after.

---

## (1) Autocomplete Component

**File**: `/home/nowaker/projekty/webapps/portal/apps/web/src/components/slash-command-popover.tsx`

**Entry points**:
- `SlashCommandPopover` (component, lines 150–410)
- `useSlashCommand()` (hook, lines 449–577)
- `expandTemplateAtSlash()` (utility, lines 431–447)
- `useCommands()` (SWR fetcher, lines 21–28)

**Component signature**:
```tsx
<SlashCommandPopover
  isOpen: boolean                        // popover visible
  searchQuery: string                    // text after /
  mode: "command" | "agent" | "model"   // mode detection
  customItems?: SlashItem[]              // /agent / /model item lists
  extraItems?: SlashItem[]               // synthetic commands: /btw, /template ...
  onSelect: (itemName: string) => void  // user picked an entry
  textareaRef: RefObject<HTMLTextAreaElement>
  slashStart: number | null              // cursor position of /
  selectedIndex: number                  // keyboard nav highlight
  onSelectedIndexChange: (index: number) => void
  onClose: () => void
/>
```

**Trigger character**: `/` (hard-coded in useSlashCommand line 470)

**Rendering logic** (lines 252–301):
- Each item renders as a button with icon + name + description
- Source label (in parens) indicates origin: `(command)`, `(mcp)`, `(skill)`, `(agent)`, `(model)`, `(template)`, `(builtin)`
- Name display: `/${itemName}` for command/template mode; bare `itemName` for agent/model modes
- Selected index highlighted with primary/10 background
- Footer hint: ↑↓ navigate, Tab/Enter select, Esc close

---

## (2) Data-Source Pipeline

**Three sources merge into one list**:

### A. Opencode Commands (via useCommands)
- **Fetcher** (line 21–28):
  ```tsx
  export function useCommands() {
    const instance = useInstanceStore((s) => s.instance);
    const port = instance?.port;
    return useSWR<OpencodeCommand[]>(
      port ? `/api/opencode/${port}/command` : null,
      fetcher,
    );
  }
  ```
- **Interface** (OpencodeCommand, lines 9–13):
  ```tsx
  { name: string; description?: string; source?: "command" | "mcp" | "skill" }
  ```
- **Injection point**: When `mode === "command"`, popover merges `commands` + `extraItems` and filters by `startsWith(lcQuery)` (line 167)

### B. Synthetic Built-in Command: /btw
- **Definition** (new.tsx lines 324–337):
  ```tsx
  const slashExtras = useMemo(() => {
    return [
      {
        name: "btw",
        description: "Side question - one short answer, no tools. Claude-Code parity.",
        source: "builtin",
      },
      ...templateSlashEntries.map((t) => ({
        name: t.name,
        source: "template",
      })),
    ];
  }, [templateSlashEntries]);
  ```
- **Source label** renders as `(builtin)`

### C. Template Slash Entries
- **Local templates** (tools-store, lines 307–312):
  ```tsx
  const local = tools
    .filter((t) => !t.isDisabled && t.isSlash)
    .map((t) => ({
      name: `template ${t.name}`,  // ← rendered as "/template Full Name"
      body: t.prompt,               // ← expansion target
    }));
  ```
- **Filesystem templates** (vibekick API, lines 313–318):
  ```tsx
  const fs = fsTemplates
    .filter((t) => t.slash)           // YAML `slash: true` flag
    .map((t) => ({
      name: `template ${t.name}`,
      body: t.prompt,
    }));
  ```
- **Combined** (line 319): `return [...local, ...fs]`
- **Source label** renders as `(template)`

**API endpoint for filtered templates**:
```
GET /api/vibekick-templates?directory={directory}
→ DirectoryFsTemplatesResponse { directory, workspaceRoot, templates: FsTemplate[] }
```

---

## (3) Substitution Logic

### A. Mode Detection (useSlashCommand.handleInputChange)
Lines 464–517 detect the slash mode by examining the line at the cursor:

**Regular commands** (line 505–515):
```tsx
const firstSpace = afterSlash.search(/\s/);
const query = firstSpace === -1 ? afterSlash : afterSlash.slice(0, firstSpace);
if (firstSpace === -1) {
  setMode("command");
  setSearchQuery(query);
  setSlashStart(lineStart);
  // popover stays open until a space
}
```

**/agent and /model** (lines 479–488):
```tsx
const subMatch = afterSlash.match(/^(agent|model)\s+(\S*)$/);
if (subMatch) {
  const sub = subMatch[1]; // "agent" or "model"
  const query = subMatch[2]; // text after space
  setMode(sub);
  setSearchQuery(query);
  // popover stays open
}
```

**/template** (lines 496–503): Special case - stays open across spaces:
```tsx
if (/^template($|\s)/i.test(afterSlash)) {
  setMode("command");
  setSearchQuery(afterSlash);  // Keep entire "template Foo Bar" as query
  // popover stays open for multi-word template names
  return;
}
```

### B. Selection Handlers

**handleSelect** (lines 548–564) replaces the `/token` with the selected item:
```tsx
const handleSelect = (itemName: string, currentValue: string): string => {
  const beforeSlash = currentValue.slice(0, slashStart);
  let newValue: string;
  if (mode === "agent") {
    newValue = `${beforeSlash}/agent ${itemName}`;
  } else if (mode === "model") {
    newValue = `${beforeSlash}/model ${itemName}`;
  } else {
    // mode === "command"
    const afterSlash = currentValue.slice(slashStart + 1);
    const firstSpace = afterSlash.search(/[\s]/);
    const tail = firstSpace === -1 ? "" : afterSlash.slice(firstSpace);
    newValue = `${beforeSlash}/${itemName} ${tail.replace(/^\s+/, "")}`;
  }
  close();
  return newValue;
};
```

For **regular commands** like `/git-master`: inserts the command name, keeps trailing text.

For **templates**: Since `itemName` is shaped `"template Full Name"`, the result is `/template Full Name `. The actual body expansion happens in the caller (new.tsx lines 1077–1103).

### C. Template Body Expansion (new.tsx)

**Detection** (lines 1079–1081):
```tsx
const template = templateSlashEntries.find(
  (t) => t.name === commandName,  // commandName = "template Full Name"
);
```

**Expansion** (lines 1082–1099):
```tsx
if (template && slashCommand.slashStart !== null) {
  const slashStart = slashCommand.slashStart;
  const firstNewline = current.indexOf("\n", slashStart);
  const endOfCommand = firstNewline === -1 ? current.length : firstNewline;
  const tokenLen = endOfCommand - slashStart;
  const { newValue, cursorPos } = expandTemplateAtSlash(
    current,
    slashStart,
    tokenLen,
    template.body,  // ← the template prompt
  );
  textareaRef.current.value = newValue;
  setText(newValue);
  scheduleDraftSave(newValue);
  textareaRef.current.setSelectionRange(cursorPos, cursorPos);
}
```

**Non-template slash commands**: Use `slashCommand.handleSelect()` and DO NOT expand body. Instead, the command text is left as-is and sent to opencode's `/command` endpoint for server-side dispatch (new.tsx lines 514–524).

---

## (4) Distinction: In-Place Expansion vs. Server Dispatch

### In-Place Expansion (Templates Only)
- **What**: `/template Foo` → `<Foo body>\n\n` (immediate textarea replacement)
- **Entry point**: new.tsx lines 1082–1099
- **Function**: `expandTemplateAtSlash()`
- **Trigger**: Selection detected `templateSlashEntries.find()`

### Server Dispatch (Regular Commands)
- **What**: `/git-master <args>` → sent to `/api/opencode/{port}/session/{id}/command`
- **Entry point**: new.tsx lines 514–524 (slash-command detection via opencode command name check)
- **Decision logic**:
  ```tsx
  let slashDispatch: { command: string; arguments: string } | null = null;
  if (checkedTemplates.length === 0 && userMessage.startsWith("/")) {
    const m = userMessage.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (m) {
      const name = m[1];
      const argsTail = m[2];
      const known = (commandsData ?? []).some((c) => c.name === name);
      if (known) {
        slashDispatch = { command: name, arguments: argsTail };
      }
    }
  }
  ```
- The command is NOT expanded in the textarea. Instead, it routes to `/api/opencode/{port}/session/{sessionId}/command` with the bare command name + args.

**Key difference**: Template slash entries have `source: "template"` and carry `body` on the entry. Regular commands have `source: "command" | "mcp" | "skill"` and no body—opencode itself handles them on server-side.

---

## (5) Project-Scope Filter

### API Endpoint
```
GET /api/vibekick-templates?directory={encodeURIComponent(directory)}
→ DirectoryFsTemplatesResponse { directory, workspaceRoot, templates: FsTemplate[] }
```

### Hook Usage (use-vibekick-templates.ts)
Lines 48–56:
```tsx
export function useFsTemplatesForDirectory(directory?: string | null) {
  const key = directory
    ? `/api/vibekick-templates?directory=${encodeURIComponent(directory)}`
    : null;
  return useSWR<DirectoryFsTemplatesResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}
```

### Server-Side Scoping
The backend endpoint (implied by the API contract) performs an upward walk from `directory` to `workspaceRoot` and returns all `.md` templates found in that ancestry. This ensures only filesystem templates relevant to the current session context appear in the list.

### Consumer Integration (new.tsx)
Lines 168–172:
```tsx
const { data: fsTemplatesResp } = useFsTemplatesForDirectory(directory);
const fsTemplates = useMemo(
  () => fsTemplatesResp?.templates ?? [],
  [fsTemplatesResp],
);
```

When `directory` changes (e.g., sidebar navigation), the SWR cache invalidates and refetches with the new directory parameter.

---

## (6) Current Project Directory

### In new.tsx (lines 108–122)
```tsx
const { directory: directoryFromUrl, autoPrompt } = Route.useSearch();
const storeDir = useVirtualSessionStore((s) => s.directory);
const directory = directoryFromUrl || storeDir || null;
```

- **URL search param**: `?directory=/abs/path` (from sidebar navigation or direct link)
- **Store fallback**: `useVirtualSessionStore` persists last-used directory across page reloads
- **Fallback**: `null` if neither is set (renders "No directory chosen" state)

### In $id.tsx (session route)
Lines 46–48:
```tsx
import { useFsTemplatesForDirectory } from "@/hooks/use-vibekick-templates";

const { data: fsTemplatesResp } = useFsTemplatesForDirectory(directory);
```

The session route reads `directory` from `session.directory` (part of the session state fetched from opencode).

---

## (7) Padding Algorithm

**Function**: `expandTemplateAtSlash()` (lines 431–447)

```tsx
export function expandTemplateAtSlash(
  value: string,
  slashStart: number,
  slashTokenLength: number,
  body: string,
): { newValue: string; cursorPos: number } {
  const before = value.slice(0, slashStart);           // "hello world"
  const tail = value.slice(slashStart + slashTokenLength); // " after"
  const after = tail.replace(/^\s+/, "");              // "after"
  
  // Count trailing newlines in the text before the slash
  const trailingNl = (before.match(/\n*$/) ?? [""])[0].length;
  
  // If before is empty, no leading pad. Otherwise, pad to 2 newlines.
  // If before already ends with 1+ newlines, pad the difference.
  const leadingPad =
    before.length === 0 ? "" : "\n".repeat(Math.max(0, 2 - trailingNl));
  
  // Always add 2 trailing newlines if after is non-empty.
  const afterPad = after.length === 0 ? "" : "\n\n";
  
  const newValue = `${before}${leadingPad}${body}${afterPad}${after}`;
  const cursorPos = (before + leadingPad + body).length;
  return { newValue, cursorPos };
}
```

**Boundary cases**:

1. **BOF (before-of-file)**:
   ```
   "" + "/template Foo" → body + "\n\n" + "rest"
   leadingPad = "" (empty before skips padding)
   afterPad = "\n\n" (rest is non-empty)
   Result: "<body>\n\nrest"
   ```

2. **After text**:
   ```
   "hello" + "/template Foo" → "hello\n\n" + body + "\n\n" + "rest"
   trailingNl = 0 (no newlines)
   leadingPad = "\n\n" (pad to 2)
   afterPad = "\n\n"
   Result: "hello\n\n<body>\n\nrest"
   ```

3. **After single newline**:
   ```
   "hello\n" + "/template Foo" → "hello\n" + "\n" + body + "\n\n" + "rest"
   trailingNl = 1
   leadingPad = "\n" (pad from 1 to 2)
   afterPad = "\n\n"
   Result: "hello\n\n<body>\n\nrest"
   ```

4. **After double newline**:
   ```
   "hello\n\n" + "/template Foo" → "hello\n\n" + "" + body + "\n\n" + "rest"
   trailingNl = 2
   leadingPad = "" (already at 2)
   afterPad = "\n\n"
   Result: "hello\n\n<body>\n\nrest"
   ```

5. **EOF (end-of-file)**:
   ```
   "hello" + "/template Foo" → "hello" + "\n\n" + body + "" + ""
   afterPad = "" (after is empty)
   Result: "hello\n\n<body>"
   ```

**Summary**: The function ensures **at least 2 newlines on each side** of the inserted body, clamped to exactly 2 (not more).

---

## (8) Existing Slash-Command Discovery Surface

### A. Popover Footer (lines 303–315)
```tsx
const footer = (
  <div className="... border-t border-border/40 ...">
    <span><kbd>↑↓</kbd> navigate</span>
    <span><kbd>Tab/Enter</kbd> select</span>
    <span><kbd>Esc</kbd> close</span>
  </div>
);
```

Rendered at the bottom of the popover on every open. Shows keyboard shortcuts but not a discoverable command list.

### B. Popover Header (lines 317–327)
```tsx
const headerLabel =
  mode === "agent" ? "Select Agent"
  : mode === "model" ? "Select Model"
  : "Select Command";
```

Indicates which list the user is browsing. Does not provide a help menu.

### C. Source Labels (lines 252–270)
Each rendered item shows its source in parens:
- `(command)` — opencode native command
- `(mcp)` — MCP tool registered to opencode
- `(skill)` — opencode skill
- `(template)` — template slash entry
- `(builtin)` — synthetic like `/btw`

### D. Item Descriptions (lines 265–296)
```tsx
{cleanedDescription && (
  <span className="... text-muted-fg ...">
    <span className="opacity-70">{sourceLabel}</span> {cleanedDescription}
  </span>
)}
```

Displayed below the item name if present. For templates, this would be the template's `description` field (not yet in scope for the slash entry, only the body).

### **No explicit help menu or `/help` command**
Users discover commands by typing `/` and seeing the filtered list. The popover does not render a static help page or reference all registered slashes without typing.

---

## Extension Points for Templates

### To add `/template Name` support:

1. **Inject template entries** as extraItems in SlashCommandPopover (✓ already done in new.tsx lines 323–337)
   ```tsx
   extraItems={slashCommand.mode === "command" ? slashExtras : undefined}
   ```

2. **Detect template selection** in onSelect handler (✓ already done in new.tsx lines 1077–1103)
   ```tsx
   const template = templateSlashEntries.find((t) => t.name === commandName);
   if (template) {
     const { newValue, cursorPos } = expandTemplateAtSlash(...);
     // insert body in-place
   }
   ```

3. **Handle mode switching** for `/template` in useSlashCommand (✓ already done in lines 496–503)
   ```tsx
   if (/^template($|\s)/i.test(afterSlash)) {
     setMode("command");
     setSearchQuery(afterSlash); // keep open across spaces
   }
   ```

4. **Ensure project-scope filtering** of templates (✓ already done via useFsTemplatesForDirectory)
   ```tsx
   const fsTemplates = useMemo(
     () => fsTemplatesResp?.templates ?? [],
     [fsTemplatesResp],
   );
   ```

All the infrastructure is in place. New templates are automatically picked up from the tools-store (isSlash flag) and filesystem (.md files with `slash: true` in frontmatter).
