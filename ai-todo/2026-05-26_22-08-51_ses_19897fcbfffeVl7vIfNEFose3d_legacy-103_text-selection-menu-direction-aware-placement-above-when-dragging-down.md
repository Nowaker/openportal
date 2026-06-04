---
status: PENDING
session: ses_19897fcbfffeVl7vIfNEFose3d
queued_at: 2026-05-26T22:08:51-05:00
legacy_number: 103
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Text selection menu: direction-aware placement (above when dragging down, below when dragging up) (DONE - c8ab08d) [loser-bump: originally #102; bumped to #103 because origin sync 52b9eb2 took #102 for the stuck-detector /health probe entry below while this work was mid-rebase]

User prompt (verbatim):

> Copy / quote inline / quote in block actions on selecting text in chat log - this menu should show intelligently on the top or bottom of the current line. Eg if I start selecting from line 2, and dragged cursor to line 3, I'm basically covering the content I may be interested to continue dragging the selection to expand it. It should know to render the menu above when I'm going down with the selection, or below if I'm going up. Render above/below most recently added selection. Not on the the very top or bottom of entire selection.

Design notes:

- Bug: [text-selection-menu.tsx](file:///home/nowaker/projekty/webapps/portal/apps/web/src/components/text-selection-menu.tsx) always rendered the floating Copy / Quote inline / Quote block toolbar at `lastRect.bottom + 6` — i.e. directly below the bottom-most rect of the selection. While the user is still dragging, this floats the toolbar exactly over the next line they want to extend the selection into, blocking their drag target.
- Fix: detect selection direction by comparing `selection.anchorNode/anchorOffset` to `range.startContainer/startOffset`. When they match, the selection is forward (anchor is the document-order-earliest point, focus is later). When they don't match, the selection is backward (anchor is at `range.end`, focus is at `range.start`).
- For forward selections (drag going down/right): position menu's BOTTOM edge `GAP=6` px above `lastRect.top`. Realized with `top: lastRect.top - GAP` plus a CSS `transform: translateY(-100%)` on render so we don't need to measure the menu's own height. Anchor `left` to `lastRect.right - 120` (right-aligned to focus side) as the existing code did.
- For backward selections (drag going up/left): position menu's TOP edge `GAP=6` px below `firstRect.bottom`. No transform. Anchor `left` to `firstRect.left` (left-aligned to focus side, since the focus point for a backward selection is on the LEFT of the first rect, not the right).
- Visual effect on multi-line selections: when the user starts selecting at line 2 and drags down to line 5, the menu sits just above line 5's top edge. Lines 6+ stay fully visible, so dragging further down isn't blocked. Symmetric for dragging up: when the focus is at line 1 from a selection anchored at line 4, the menu sits just below line 1's bottom edge — lines above line 1 stay visible.
- Single-line selections degenerate naturally: `firstRect === lastRect`, so the menu sits either just above or just below that single rect depending on drag direction. The user can still see the destination they're dragging toward in either direction.
- Direction change mid-drag is handled automatically by the existing `selectionchange` listener — the position recomputes every time the focus moves. If the user reverses direction (was dragging down past anchor, now drags up past anchor), `isForward` flips and the menu reposition follows immediately.
- New `flipUp: boolean` field added to the `MenuPos` interface. Render reads `pos.flipUp` to decide whether to apply `translateY(-100%)`. Internal-only — not exposed via props.
- Did NOT change the dismissal logic, the dismissingRef escape-hatch behavior, the keyboard handler, the outside-click handler, the clipboard/quote action handlers, the test-data attributes, or the menu's styling. Surgical fix scoped to positioning only.
- Did NOT add viewport clamping (right-edge overflow protection, top/bottom off-screen fallback). The original code didn't have it either; expanding scope risks regression and the user's complaint was direction-awareness, not viewport-aware clamping.
