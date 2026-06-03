---
status: DONE
commit: 
session: ses_17c680b07ffe7Oj76CKZHF1XSn
queued_at: 2026-06-01T09:30:36-05:00
legacy_number: 159
---

# Chat log: sticky overlay of the most-recently-scrolled-past user prompt

User prompt (verbatim):

> main chat log / session log: when scrolled down past user prompt, make that user prompt sticky. only a single one, one that is "above". say:
>
> prompt1
> response1
> prompt2
> response2
>
> when i scroll somewhere to response1 where prompt1 would already be out of sight, it won't be - a small sticky element will be there with prompt1. limited to 2 lines only. can expand using ^ symbol (but pointing to the bottom) - but never to get more than 40% window height. viertical scroll okay when prompt was very long.
>
> likewise, when i scroll somewhere to response2 where prompt2 would already be out of sight, same story.

Design notes:

- New component `apps/web/src/components/sticky-user-prompt.tsx` (`StickyUserPromptOverlay`). Rendered inside the existing `relative flex-1 min-h-0` chat shell in `apps/web/src/routes/_app/session/$id.tsx` as a sibling of `chatContainerRef`, positioned `absolute top-0 left-0 right-0 z-20 pointer-events-none` so the overlay sits visually above the scroll area without intercepting scroll/select gestures except on the chip itself (`pointer-events-auto`).
- Detection: walks `chatContainerRef.current.querySelectorAll('[data-role="user"]')` on every scroll/resize (rAF-throttled). For each user-message DOM node, compares `getBoundingClientRect().bottom` against the container's top edge; remembers the LAST one whose bottom has scrolled above the top. `break` on the first not-yet-off-screen entry (DOM order is chronological - safe to bail early). The remembered node's `dataset.messageId` is the sticky target.
- Text extraction: builds `Map<messageId, text>` from `messages` prop (filter `info.role === "user"`, join text parts). OMO bodies are already stripped server-side so the preview is clean. Re-runs on `messages` change so live-arriving prompts re-evaluate the sticky immediately.
- Collapsed: `line-clamp-2 whitespace-pre-wrap break-words` (2 lines max).
- Expanded: `overflow-y-auto` with `style={{ maxHeight: "40vh" }}` so very long prompts internally scroll, capped at 40% of viewport height per spec.
- Chevron toggle: `ChevronDownIcon` (collapsed → expand) / `ChevronUpIcon` (expanded → collapse). Lives in a right-aligned column with a tiny "jump" button below it that calls `scrollIntoView({ block: "start", behavior: "smooth" })` on the matching `[data-message-id="..."]` element - convenient when you want to navigate back to the prompt without manual scroll.
- Auto-collapse on prompt change: an effect resets `expanded=false` whenever `currentId` flips, so scrolling past prompt2 starts fresh in collapsed mode (the user expanded prompt1 doesn't carry over).
- Text-selection: the body is rendered in a plain `<div>` (not a `<button>`) so the AGENTS.md "Text selection (mandatory)" rule is honoured - users can highlight and copy prompt text out of the sticky overlay.
- Styling matches the in-chat user-message tint (`bg-primary/15 border border-primary/30`) with `backdrop-blur-sm` so the chat behind shows through faintly when the page background isn't fully opaque.
- ResizeObserver on the scroll container catches viewport changes (mobile address-bar collapse, soft keyboard, etc.) and re-evaluates. `requestAnimationFrame` debounces back-to-back scroll fires.
- Files: `apps/web/src/components/sticky-user-prompt.tsx` (new), `apps/web/src/routes/_app/session/$id.tsx` (import + render).
- Branch: `feat/sticky-user-prompt` off `main-nowaker` (at the time, 9cc6f79). Merged + deployed + pushed per the user's "git worktree -> main -> deploy -> push" template.
