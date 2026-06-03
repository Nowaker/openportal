---
status: PENDING
commit: 
session: ses_18572f9a8ffecB57FPahdTEZ4Y
queued_at: 2026-06-01T08:41:19-05:00
legacy_number: 152
---

# Composer: contenteditable refactor so text flows around the button slot

User prompt (verbatim):

> JESUS. the text still goes behind the buttons!!!
> for fucks sake, can't you not understand? make the submit / mic / stop buttons behave like they're images xxxx between text. text to flow around them. not under them!

Design notes:

- Three iterations of right-padding (pr-14 → pr-16 → pr-20 → pr-24) and a "row below" attempt all failed the user's literal ask: text should FLOW AROUND the buttons like inline images. A `<textarea>` is a replaced element - its internal text is opaque to CSS, so `float` / `shape-outside` on any child cannot make text wrap around it. The architectural answer is to swap the textarea for a `<div contenteditable>` and put the buttons inside as a CSS-floated first child.
- New component: `apps/web/src/components/ui/composer-editable.tsx`. Wraps a `<div contenteditable>`. Augments the underlying div with `value` / `selectionStart` / `selectionEnd` / `setSelectionRange` / `setRangeText` via `Object.defineProperty` so existing consumer code typed against `HTMLTextAreaElement` (STT transcript append, slash-command popover, file-mention popover, draft restore, BroadcastChannel cross-tab sync, post-submit clear) compiles via `as unknown as` cast and runs unchanged at runtime. The ref is forwarded to the live DOM element (not a custom handle) so popovers can `getComputedStyle()` / `getBoundingClientRect()` it directly.
- Button slot: a `contenteditable={false}` first child carrying `float-right`. Top-right placement (bottom-right would need JS-driven `shape-outside` polygons recalculated on every input event - brittle per oracle).
- Helpers: `readEditableText` walks text + element nodes excluding the slot, treating `<br>` and block-element starts as newlines (matching the browser's own contenteditable `innerText` semantics). `readCaretOffset` / `applySelection` translate between numeric offsets and DOM Range positions. `setRangeText` uses `document.execCommand("insertText", ...)` to preserve native undo/redo history.
- IME composition is tracked via a ref so onChange does NOT fire mid-composition (would fight Android Gboard / iOS predictive input).
- Paste is forced to plain text via clipboardData `text/plain` extraction; consumer's onPaste runs first so image-paste handler still fires (consumer calls `e.preventDefault()` for images, component bails).
- Placeholder is rendered as a sibling overlay span driven by React state. CSS `:empty` won't match because the button slot is always a child.
- Popover compatibility: `getCaretCoordinates` in both `apps/web/src/components/slash-command-popover.tsx` and `apps/web/src/components/file-mention-popover.tsx` branches on element type. Textareas / inputs use the legacy clone-the-styles trick (their text is opaque to CSS). Contenteditable elements use the live Selection / Range API directly, with a zero-width-space marker fallback for collapsed ranges that some browsers return zero client rects for.
- Consumer swap: `<Textarea>` → `<ComposerEditable>` in both `apps/web/src/routes/_app/session/$id.tsx` and `apps/web/src/routes/_app/session/new.tsx`. The absolute-positioned bottom-right overlay div is GONE - its inner button JSX moves into the `buttonSlot` prop. `pr-24` removed from the className. `isDisabled` renamed to `disabled` to match the new prop API. Existing ref type stays `useRef<HTMLTextAreaElement>(null)` with a structural cast at the ref boundary.
- AGENTS.md "Composer layout" section rewritten in the same commit to mark the contenteditable architecture as the binding contract and explain why a textarea cannot achieve flow-around layout. The previous floating-overlay bullet is replaced.
- Worktree: `~/projekty/webapps/portal-contenteditable` on branch `composer-contenteditable`.
