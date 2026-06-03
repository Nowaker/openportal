---
status: DONE
commit: 3e0dd5b
session: ses_1983566f5ffemNKO0R8Bm8e1Go
queued_at: 2026-05-26T23:56:31-05:00
legacy_number: 85
---

# Mobile composer: submit button always visible + textarea height cap + correct touch scrolling + no overlap with other content

User prompt (verbatim):

> When submitting a long ass prompt on mobile like this one: https://portal.desktop.ts.nowaker.net:8443/session/ses_1983fb909ffeVSIJakTMCpzx3O?server=srv-2dy1srwz
> The prompt field gets so big that scrolling starts being flaky. Beyond certain point, I can't scroll down enough and won't see the submit button. Task: no matter what, submit button must be always visible. Maybe absolute positioning, or something hybrid, eg it kind of floats on the right (where it currently is), between the bottom of the prompt field and even top of the prompt field, never beyond h start and h end of prompt field, and striving to be on its bottom as possible, but also within viewport (but can't go past prompt's top H and bottom H).
>
> It feels the field is just getting extended and extended, without limit on mobile, which is the source of the problem. I also noticed that tap hold scrolling when. Within the input field, it scrolls main page, rather than the input field. Only when tap hold scrolling outside of input field should the website scroll.
>
> And when this input field. Is big. It covers init templates selection on new session. Something is wrong. No matter what size the prompt field ends up consuming, it cannot take away the space from other content.
>
> Git work tree. Agents MD and Ai todo MD. Merge to primary, deploy.

Design notes:

- Four distinct bugs in one prompt:
  1. **Submit button gets clipped on long prompts.** Composer wrapper in `apps/web/src/routes/_app/session/$id.tsx:5775-5778` has `style={{ maxHeight: composerMaxHeight }}` + `overflow-hidden`. With `field-sizing: content` on the textarea + flex `items-stretch` on the row + `shrink-0` on the submit-button column, the textarea grows beyond the wrapper's max-height in some Android Chrome layout paths and the bottom of the row (containing the submit button) gets clipped by the wrapper's `overflow-hidden`.
  2. **New-session composer has no height cap at all.** `apps/web/src/routes/_app/session/new.tsx:768` is `<div className="border-t border-border shrink-0 relative flex flex-col overflow-hidden">` with NO `style={{ maxHeight }}`. The composer container grows with the textarea content because `shrink-0`; the templates section above (line 668 `flex-1 min-h-0 overflow-y-auto`) gets squeezed and on long prompts the composer pushes the templates out of the viewport (per the user: "covers init templates selection").
  3. **Touch-drag inside textarea scrolls the page instead of the textarea content.** Default mobile behavior on a non-scrollable textarea is to bubble the touchmove to the nearest scrollable ancestor (the chat container). Once the textarea grows tall enough to need scrolling, `overscroll-behavior: contain` + explicit `touch-action: pan-y` on the textarea would keep the gesture in the textarea.
  4. **The 50dvh/60% cap is the right idea but the implementation lets the textarea size dictate the layout** rather than the layout dictating textarea bounds. Need to make the cap authoritative.

- Approach (matches user's spec):
  - Extract `useComposerMaxHeight` from session/$id.tsx into a shared hook at `apps/web/src/hooks/use-composer-max-height.ts` so both routes use the same `Math.round(visualViewport.height * 0.6)` formula with visualViewport resize/scroll listeners.
  - Apply the same `style={{ maxHeight: ${composerMaxHeight}px }}` cap to the new-session composer wrapper at `apps/web/src/routes/_app/session/new.tsx:768`. Closes bug #2 + #4.
  - Refactor the submit button to **absolute positioning inside a relative wrapper around the textarea**, with the textarea getting `pr-14` (or similar) padding-right to keep the cursor from sliding under the button. The wrapper is `position: relative` and is the same element that already has the textarea + textarea wrapper. The button sits at `bottom: <gap>px; right: <gap>px` (matching the current visual spacing). Because the composer wrapper is capped at `composerMaxHeight` and the textarea wrapper is inside it, the button's anchor is always within the visible composer area — closes bug #1. (Matches user's explicit ask: "absolute positioning ... floats on the right ... striving to be on its bottom as possible, but also within viewport (but can't go past prompt's top H and bottom H)".)
  - Add `touch-action: pan-y` and `overscroll-behavior: contain` to the textarea via the shared `Textarea` component class list at `apps/web/src/components/ui/textarea.tsx`. Closes bug #3.
  - Mic + Stop buttons (currently above the submit button in the right column) move with the submit button — they stack vertically and float together, so they all stay in the same visual position relative to the textarea.

- Worktree: `~/projekty/webapps/portal-mobile-composer` (branch `mobile-composer-fix`).
- Merge to `main-nowaker` and deploy via `scripts/deploy.sh` (dev probe on `:5001` then prod on `:5000`) — both per the user's "merge to primary, deploy" line.

---
