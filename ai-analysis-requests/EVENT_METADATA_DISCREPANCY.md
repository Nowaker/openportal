# Event & Error Metadata Discrepancy Analysis

**Branch**: portal-event-metadata  
**Issue**: Session chat error/event entries lack datetime, permalink, and message info that normal messages have.

---

## Summary

Error and compaction event rows in the session chat render with minimal metadata while normal user/assistant message rows include datetime stamps, absolute/relative times, and clickable permalinks. The root cause is that shared renderer components for errors/events (`ErrorBox`, `CompactionEventRow`, `SessionLevelErrorBox`) do not receive or render timestamp or permalink data, while the normal message rendering path (`renderMessage`) explicitly formats and displays these fields.

---

## Shared Rendering Architecture

### Main Message Renderer: `renderMessage()` 
**File**: `apps/web/src/routes/_app/session/$id.tsx`  
**Lines**: ~5314 (definition via useCallback) → called at 5462, 5475, 5484

This is the **single entry point** for all message-like content in the chat. It dispatches on message type:
- Normal user/assistant messages → full metadata rendering
- Error messages → delegates to `ErrorBox` (lines 3255–3261)
- Compaction events → delegates to `CompactionEventRow` (line 248)
- Tool calls, permissions, past decisions → their own renderers

The critical issue: `renderMessage` extracts and renders timestamps ONLY for normal messages, never passes time data to error/event renderers.

---

## Where Metadata Is/Isn't Rendered

### ✅ Normal Messages (HAVE metadata)
**Location**: `renderMessage` → inner JSX around lines 2867–3195

```
Message timestamp:     formatMessageTime(message.info.time.created, dateFormat)       [line 2867]
Absolute/relative:     formatAbsoluteAndRelative(message.info.time?.created)          [line 2869]
Permalink anchor:       href={`#msg-${encodeURIComponent(messageId)}`}                 [line 2135]
Message info modal:     <MessageInfoModal messageId={...} />                          [line 3161–3167]
```

Rendered in header row at lines 3153–3195 with classes:
- `data-test="portal-msg-meta-line"` (line 3191)
- Shows: fork/revert buttons, timestamp, message type badge

### ❌ Error Messages (MISSING metadata)
**Location**: `renderMessage` → delegates to `ErrorBox` at lines 3255–3261

```tsx
{errorDescription && (
  <ErrorBox
    sessionId={sessionId}
    messageId={message.info.id}
    isLastError={isLastError}
    gutter={textContent || toolCalls.length > 0 ? "mt-2 ml-6" : ""}
    title={errorDescription.title}
    detail={errorDescription.detail}
    // NOTE: NO time/created field passed
  />
)}
```

**ErrorBox definition** (lines 2649–2693):
- Accepts: `sessionId`, `messageId`, `isLastError`, `gutter`, `title`, `detail`
- Renders: title + detail text + acknowledge button (if isLastError)
- **Renders NO timestamp, NO permalink, NO info modal**
- Uses `message.info.id` as messageId but does NOT access `message.info.time`

### ❌ Session-Level Errors (MISSING metadata)
**Location**: Session error box rendered separately at lines 3449–3472

```tsx
function SessionLevelErrorBox({
  sessionId,
  lastError,
}: {
  sessionId: string;
  lastError: string;
}) {
  // ...
  return (
    <ErrorBox
      sessionId={sessionId}
      messageId={errorId}  // synthetic hash, NOT a real message ID
      isLastError={true}
      gutter="mx-3 my-3"
      title={parsed.title}
      detail={parsed.detail}
      // NOTE: NO time data available; this is session.error string, not a message
    />
  );
}
```

Called at line 3560 (top of chat) when `session.lastError` is non-null.

**Problem**: `lastError` is a raw error string, not a message object. It has no timestamp in the original data model.

### ❌ Compaction Events (MISSING metadata)
**Location**: `renderMessage` → called at line 248

```tsx
<CompactionEventRow key={part.id} part={part} />
```

**CompactionEventRow definition** (lines 3410–3447):
- Accepts: `part` (compaction part object)
- Renders: one-line badge ("Auto-compaction" or "Manual compaction") with overflow indicator
- **Renders NO timestamp, NO permalink, NO message info modal**
- Has access to `part.id` but NOT to message creation time

---

## Data Flow & Missing Connections

### Error Messages (per-message errors)
1. **Source**: `message.info.error` (line 2935)
2. **Available**: `message.info.time.created` (at line 2869 for normal messages)
3. **Called with**: `ErrorBox(... title, detail)` (lines 3255–3261)
4. **Not called with**: `message.info.time`, `message.info.id` (as full timestamp-aware messageId)
5. **Result**: Error box loses timestamp that already exists in message data

### Compaction Events (per-message compaction parts)
1. **Source**: `message.parts[].type === "compaction"` (isCompactionPart predicate)
2. **Available**: Parent `message.info.time.created`
3. **Called with**: `CompactionEventRow(part)` (line 248)
4. **Not called with**: Parent message's time, message ID, or message object
5. **Result**: Compaction loses all temporal context

### Session Errors
1. **Source**: `session.lastError` (string, not message)
2. **Available**: No timestamp (error is session-level, not message-level)
3. **Type mismatch**: ErrorBox expects to be a message row, SessionLevelErrorBox pretends with synthetic `errorId`
4. **Result**: No way to add timestamp without schema change

---

## Conditional Branches to Inspect/Patch

### Primary Patch Target: `ErrorBox` Component
**File**: `apps/web/src/routes/_app/session/$id.tsx:2649–2693`

**Current signature**:
```tsx
function ErrorBox({
  sessionId,
  messageId,
  isLastError,
  gutter,
  title,
  detail,
}: {
  sessionId: string;
  messageId: string;
  isLastError: boolean;
  gutter: string;
  title: string;
  detail?: string;
})
```

**To fix**: 
1. Add optional `createdMs?: number` parameter
2. Add optional `showPermalink?: boolean` parameter
3. Inside render (lines 2671–2692), add timestamp + permalink in header row above title/detail
4. Follow the pattern from normal message headers (lines 3153–3195)

### Secondary Patch Target: `CompactionEventRow` Component  
**File**: `apps/web/src/routes/_app/session/$id.tsx:3410–3447`

**Current signature**:
```tsx
function CompactionEventRow({
  part,
}: {
  part: Part & {
    id: string;
    type: "compaction";
    auto?: boolean;
    overflow?: boolean;
    tail_start_id?: string;
  };
})
```

**To fix**:
1. Add optional `createdMs?: number` parameter
2. Add optional `messageId?: string` parameter (parent message ID for permalink)
3. Inside render (lines 3429–3446), add timestamp line above or below the compaction badge
4. Add permalink anchor via `id={`msg-${messageId}`}` if messageId provided

### Tertiary Patch Target: Call Sites
**File**: `apps/web/src/routes/_app/session/$id.tsx`

**Line 3255–3261** (error in normal message):
```tsx
{errorDescription && (
  <ErrorBox
    sessionId={sessionId}
    messageId={message.info.id}
    isLastError={isLastError}
    gutter={textContent || toolCalls.length > 0 ? "mt-2 ml-6" : ""}
    title={errorDescription.title}
    detail={errorDescription.detail}
    // ADD: createdMs={message.info.time?.created}, showPermalink={true}
  />
)}
```

**Line 248** (compaction in normal message):
```tsx
<CompactionEventRow key={part.id} part={part} />
// ADD: createdMs={message.info.time?.created} messageId={message.info.id}
```

**Line 3463–3471** (session-level error):
```tsx
<ErrorBox
  sessionId={sessionId}
  messageId={errorId}
  isLastError={true}
  gutter="mx-3 my-3"
  title={parsed.title}
  detail={parsed.detail}
  // NOTE: No time available here; session.error is not a message
  // Decision needed: add synthetic createdMs={Date.now()} or leave as-is
/>
```

---

## Design Decisions Needed (Downstream)

1. **Session-level errors**: Should `session.lastError` include a timestamp in the upstream opencode data model, or should ErrorBox synthetic-timestamp these on first render?

2. **Permalink scoping**: Should error/compaction rows link to themselves via `#msg-<id>`, or should they link to the parent message? (Compactions are message parts, so parent seems correct.)

3. **Metadata row density**: Should error/compaction metadata follow the exact same pattern as normal message rows (fork/revert buttons, info modal link), or a simpler inline timestamp-only approach?

4. **Mobile rendering**: Do error/compaction timestamps need the same `formatAbsoluteAndRelative()` tooltip as normal messages, or just `formatMessageTime()`?

---

## Files to Change

1. **`apps/web/src/routes/_app/session/$id.tsx`**
   - `ErrorBox()` component (lines 2649–2693)
   - `CompactionEventRow()` component (lines 3410–3447)
   - Call sites at lines 248, 3255–3261, 3463–3471

2. **Potentially**: `apps/web/src/lib/format-time.ts`
   - Verify `formatMessageTime()` and `formatAbsoluteAndRelative()` signatures match usage in normal messages

---

## Testing Approach

1. **Error message**: Create a session with a failed assistant turn; verify error row now shows datetime + permalink
2. **Compaction event**: Create a session with compacted history; verify compaction row now shows datetime
3. **Session error**: If session.lastError has new timestamp, verify it renders
4. **Mobile**: Check that error/compaction metadata doesn't break narrow viewports
5. **Acknowledged errors**: Verify timestamp persists after error is acknowledged (faded but still readable)

---

## References

- **Main route**: `apps/web/src/routes/_app/session/$id.tsx`
- **Message formatting**: `formatMessageTime()`, `formatAbsoluteAndRelative()` (imported from `@/lib/format-time`)
- **Normal message metadata row**: Lines 3153–3195 (pattern to follow)
- **Error rendering**: Lines 2649–2693 + 3255–3261 + 3463–3471
- **Compaction rendering**: Lines 3410–3447 + 248
