# Message actions consistency audit

Catalogue of per-message actions in the chat surface as of 2026-05-21,
focused on consistency gaps that should be closed.

## Per-message action inventory

Each row in `apps/web/src/routes/_app/session/$id.tsx` renders these
actions when hovering / interacting with a message:

| Action | Implementation | data-test | aria-label | title | Settings toggle |
|---|---|---|---|---|---|
| **Star** | `StarMessageButton` (star-message-button.tsx) | `portal-msg-star` (added in this commit) | "Star/Unstar message" | "Star this message" | none |
| **Fork from here** | inline button in $id.tsx:2477 | `portal-msg-fork` | "Fork to a new session from this message" | "Fork to a new session from this message" | per-icon visibility (Chat tab) |
| **Revert to here** | inline button in $id.tsx:2489 | `portal-msg-revert` | "Revert to before this message" | "Revert to before this message" | per-icon visibility (Chat tab) |
| **Copy markdown** | inline button in $id.tsx:1809 | `portal-msg-copy` | "Copy message markdown" | "Copy message markdown" (or "Copied!" when active) | per-icon visibility (Chat tab) |
| **Permalink timestamp** | the `<a>` anchor next to the time | none | "Jump to message ..." | "5/20, 19:36" (the timestamp itself) | per-icon visibility (Chat tab) |
| **Expand tool inline** | tool-row chevron (recently shipped 1d9cf16) | `portal-tool-expand` | "Expand tool call inline" | "Expand tool call" | per-icon visibility (Chat tab) |
| **Open tool modal** | (i) info icon (shipped 1d9cf16) | `portal-tool-info` | "Show full tool info modal" | "Show tool details" | per-icon visibility (Chat tab) |

## Consistency gaps + concrete fixes

### Gap 1: data-test coverage was patchy

**Before this commit**: Star button had no `data-test`. Headless drivers
could not target it. Fork / Revert / Copy did have selectors.

**Fixed in this commit**: Added `data-test="portal-msg-star"` to
`star-message-button.tsx`. All 7 per-message actions now have stable
selectors.

### Gap 2: title text duplicates aria-label

Fork + Revert + Copy use the same text for both `aria-label` and `title`.
This is technically fine for screen reader / tooltip parity but means the
tooltip is just a repeat of what the screen reader speaks - no extra hint
for sighted users. Compare with the Star button which uses different copy
("Star/Unstar message" vs "Star this message" / "Remove star") to add
context-aware nuance.

**Concrete fix** (deferred - needs UX call): align all per-message actions
on either "tooltip and aria identical" or "tooltip adds context-specific
hint". Pattern choice is the user's; this audit just flags the divergence.

### Gap 3: per-icon visibility grid has 6 entries but 7 actions

The Chat tab's per-icon visibility grid lets users hide individual icons
on desktop / mobile. The grid covers:

- Fork from here
- Revert to here
- Copy markdown
- Expand tool call inline
- Show full info (modal)
- Permalink timestamp

The **Star** button has no visibility toggle. Some users may want to hide
it on mobile where screen real estate is tight.

**Concrete fix** (1-line code change in
`apps/web/src/stores/icon-visibility-store.ts` + 1 row in the Settings
grid): add `star` as a 7th icon entry. This audit identifies the gap but
defers the implementation until a user actually requests star-hiding.

### Gap 4: expand-vs-info paradigm only applies to tools

The expand-vs-info icon split (1d9cf16) lives ONLY on tool rows. Assistant
text rows have no equivalent "inline expand" vs "full info modal"
treatment - the text itself IS the body, and there is no metadata modal
on text.

**No action required**: this is intentional - text rows don't need an
"expand" because they are already visible, and there is no separate
metadata layer worth a modal. Documented here so future contributors
don't try to add it for parity's sake.

### Gap 5: keyboard activation parity

Star, Fork, Revert, Copy all activate on click. None handle Enter / Space
explicitly because they are `<button>` elements (the browser handles it).
The permalink timestamp is an `<a>` and activates on Enter only. No fix
needed; HTML semantics carry it.

### Gap 6: hover-only visibility behaviour

All six grid actions render only on hover (per-icon visibility settings
control whether they appear at all per-platform). Star sits in the time
gutter and is ALWAYS visible (faded when unstarred, gold when starred).
This is intentional - starred status needs to be visible without hovering.

**No action required**: documented for future contributors who might
remove the Star's always-visible state on the false assumption of
consistency.

### Gap 7: Star + Fork + Revert affect server state; Copy is client-only

Star writes to the server-side starred-messages store. Fork hits
`/session/<id>/fork`. Revert hits the message-DELETE route. Copy is a
local clipboard write only.

**Optional polish** (deferred): visual differentiation between
"local-only" and "writes to server" actions (small dot indicator, or
intent="warning" tint on the server-writing buttons). Subtle; not
critical.

## Summary

- **Closed in this commit**: Star data-test selector parity.
- **Open with concrete fix path**: per-icon visibility grid coverage of
  Star (1-line + 1-row).
- **Deferred pending UX decision**: tooltip-vs-aria divergence policy,
  visual differentiation for local-vs-server actions.
- **Intentional (no action)**: expand-vs-info on text rows, Star
  always-visible.
