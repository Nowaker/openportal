# OpenPortal design consistency

Canonical reference for spacing, color, typography, link styling,
button hierarchy, indicator palette, and modal/state-URL conventions
across the openportal frontend.

Synthesized from `apps/web/src/{components,routes,hooks}` after the
2026-05 ULW pass. Treat this as the source of truth for new UI work.
When the existing code conflicts with this doc, the EXISTING code
wins on the first conflict (note the divergence here, then refactor
toward the canonical pattern in a follow-up).

## Source-of-truth files

| Concern | File |
|---|---|
| Tailwind theme tokens | `apps/web/src/main.css` (oklch CSS variables) |
| Tailwind v4 inline config | `apps/web/src/main.css` `@theme` block |
| Icon set | `@heroicons/react/24/outline` (24px source, scaled via `size-N`) |
| UI primitives | `apps/web/src/components/ui/*` (UILink, Button shell) |
| Chat display tokens | `apps/web/src/stores/chat-display-store.ts` |
| Date/time tokens | `apps/web/src/lib/format-time.ts`, `useDateFormatStore` |
| Sidebar token | `apps/web/src/stores/sidebar-expand-store.ts` |

Tailwind v4 is in use (Vite plugin, no `tailwind.config.*` file).
Custom tokens live as CSS variables in `main.css` and surface as
`bg-fg`, `text-muted-fg`, `border-border`, etc. through the
`@theme` block.

## Spacing

Use Tailwind spacing scale verbatim. No bespoke gap values.

| Token | Use case |
|---|---|
| `gap-1`, `gap-1.5` | Inline icon row inside a message/tool row |
| `gap-2` | Form field stack |
| `gap-3` | Section divider |
| `gap-4`, `gap-6` | Layout columns |
| `space-y-2` | Settings sub-section stack |
| `p-0.5` | Icon button padding (matches `size-3.5` icons) |
| `px-2 py-1` | Compact text button |
| `px-3 py-2` | Standard panel padding |
| `py-0.5` | Message-row vertical rhythm |
| `pl-3 pr-3 py-0.5` | Sidebar row vertical rhythm |

Arbitrary spacing values (`pl-[7px]`, `gap-[3px]`) are forbidden
except for one-off pixel alignment that the spacing scale literally
cannot express. Default to the scale.

## Color tokens (semantic)

OKLCH CSS variables in `main.css`. Always prefer semantic names over
literal Tailwind colors.

| Variable | Tailwind alias | Use case |
|---|---|---|
| `--color-fg` | `text-fg`, `bg-fg` | Primary foreground |
| `--color-muted-fg` | `text-muted-fg` | Secondary text |
| `--color-fg/90`, `/70`, `/60` | Same with opacity | De-emphasized variants |
| `--color-bg` | `bg-bg` | Page background |
| `--color-muted` | `bg-muted/N` | Subtle surfaces (`/20`, `/25`, `/40`, `/50`) |
| `--color-border` | `border-border` | Standard separators |
| `--color-primary` | `text-primary`, `bg-primary`, `ring-primary` | Accent (focus, highlights, "active" affordances) |
| `--color-danger` | `text-danger`, `border-danger/N`, `bg-danger-subtle/N` | Errors, destructive actions |
| `--color-warning` | `text-warning`, `border-warning/N`, `bg-warning/N` | In-flight / busy / needs-attention |
| `--color-success` (if defined) | n/a yet | Reserved |
| `bg-amber-300/40` | (raw) | Search highlight `<mark>` only — exception |

NEVER use raw Tailwind palette names (`text-red-500`, `bg-blue-400`)
outside of `<mark>` substring highlights or one-off
diagnostic-screen surfaces.

## Typography

| Class | Use case |
|---|---|
| `text-[10px]` | Timestamp permalink (`MessagePermalinkTimestamp`) |
| `text-xs` (12px) | Tool-call rows, sidebar metadata, secondary labels |
| `text-sm` (14px) | Message rows, primary sidebar rows, form labels |
| `text-md` (16px) | Section headings inside panels |
| `text-lg` (18px) | Page sub-titles |
| `text-2xl` | Settings tab title (`<h2>`) |
| `font-mono` | Tool input/output, code, IDs |
| `font-semibold` | `<h3>` section title, primary button label |
| `font-medium` | Tool-call label, sidebar project header |
| `font-normal italic` | Archived session row (de-emphasized) |
| `tabular-nums` | Timestamps, counts, durations |
| `whitespace-pre-wrap` | Tool output, pending-prompt body |
| `whitespace-nowrap` | Compact timestamps |
| `truncate` | Long titles in fixed-width slots |

## Heading hierarchy

Per `AGENTS.md > Settings UI structure`, every `<TabPanel>` has:

- ONE `<h2>` for the tab title.
- Each sub-section inside the panel uses `<h3 className="text-sm font-semibold">` plus a `<p className="text-xs text-muted-fg">` description.

Never mix `<h2>` for tab + sub-section in the same panel — produces
two competing top-level headings per panel. The `ac069c5` cleanup
normalized everything; this is now a hard rule.

When adding a sub-section to an existing tab:

```tsx
<section className="space-y-2">
  <div>
    <h3 className="text-sm font-semibold">Section title</h3>
    <p className="text-xs text-muted-fg">
      One-paragraph description of what this knob does and why.
    </p>
  </div>
  <YourSettingComponent />
</section>
```

## Link styling

Two primitives:

- **`UILink`** from `apps/web/src/components/ui/link.tsx` — wraps
  tanstack-router `Link`, applies the global hover style, and is the
  default for any internal navigation.
- **`<a>`** (raw anchor) — external URLs only. Always include
  `target="_blank" rel="noopener noreferrer"` for off-portal links.

NEVER mix `<button onClick={() => navigate(...)}>` with link
semantics. If it navigates, it's a link. The rule is paste-the-URL +
hard-refresh → exact same view (see "Everything is a permalink" in
AGENTS.md).

Style: links inherit text color and underline on hover only:
`hover:underline underline-offset-2`. No persistent underline. No
color shift. The hover affordance is enough on its own.

## Button hierarchy

Three tiers. Each has a single canonical class set.

### Tier 1 — primary action

```tsx
<Button intent="primary">Submit</Button>
```

Background `bg-primary`, foreground `text-bg`. Used for the single
most-important action per surface (form submit, modal confirm).

### Tier 2 — secondary action

```tsx
<Button intent="secondary">Cancel</Button>
```

Outline button, `border-border`. For the secondary affordance next
to a primary.

### Tier 3 — icon affordance (action row, sidebar, message header)

```tsx
<button
  type="button"
  onClick={...}
  aria-label="..."
  title="..."
  className="rounded p-0.5 text-muted-fg/70 hover:bg-muted/40 hover:text-fg transition-colors"
>
  <SomeIcon className="size-3.5" />
</button>
```

`size-3.5` for inline action-row icons. `size-4` for sidebar
expansion chevrons. `size-5` for top-level toolbar icons.

EVERY interactive icon button MUST carry `aria-label` AND `title`,
with the same text. Hover affordance via `hover:bg-muted/40`. No
border. No box shadow.

## Indicator palette

### Pending-prompt badges (per-message, two distinct states)

Two semantically-different badges that the user must be able to tell
apart. Different code paths. Never unify:

| Badge | When | Source | Meaning |
|---|---|---|---|
| `Waiting for OpenCode` (spinner + attempts count) | `info._pending !== null` | Virtual user message synthesized by `toVirtualUserMessage` in `apps/web/src/server/opencode/[port]/session/[id]/messages.ts` from rows in the pending-prompt archive (`apps/web/src/server/lib/prompt-archive.ts`). | Portal accepted the prompt and stored it durably; the worker hasn't yet handed it to opencode. Typically <1s, longer if opencode is unreachable. |
| `Queued` (or `Queued - blocked on question above`) | `message.isQueued && !isPending && !isAssistant` | `renderMessage`'s computed flag in `apps/web/src/routes/_app/session/$id.tsx`. | The user message is a REAL row from opencode's stream, but no assistant response follows it yet. opencode has the prompt; it's queued behind earlier turns. |

The `Queued` answered-detection scans forward past intermediate user
messages — opencode batches multiple consecutive user prompts under
a single assistant response (`db2ae95` fix). Never break the scan
on a sibling user message.

### Session status badge (title bar)

`apps/web/src/components/session-status-badge.tsx` renders ONE badge
at a time based on the unified indicator state from `useIndicator`.
Priority chain (first match wins):

| Priority | Badge | When | Color | Pulse |
|---|---|---|---|---|
| 1 | `ERROR` | `state.lastError !== null` | danger | no |
| 2 | `QUESTION` | `pendingQuestionIds.length > 0` | sky-500 | yes |
| 3 | `PERMISSION` | `pendingPermissionIds.length > 0` | sky-500 | yes |
| 4 | `COMPACTING` | `state.mode === "compaction"` | violet-500 | yes |
| 5 | `TOOL: <name>` | `currentToolName !== null && busy` | warning | yes |
| 6 | `THINKING` | `state.busy` | warning | yes |
| 7 | `QUEUED` | `pendingPromptIds.length > 0` | muted | no |
| — | (no badge) | otherwise | — | — |

`COMPACTING` and `TOOL` source from `info.mode === "compaction"` and
the latest in-flight tool part respectively (see `applyOpencodeEvent`
in `apps/web/src/server/lib/indicator-state.ts`). Both anchor on
`inFlightAssistantId` and clear when that assistant finalizes.

Late-subscriber gap: if openportal restarts mid-compaction or
mid-tool-call, the broadcaster has no event to source `mode` or
`currentToolName` from until the next opencode event. A snapshot
fetch of `GET /session/:id/message` on connect would close this;
not implemented in v1. New work emerging during the user's session
surfaces the badge within SSE round-trip latency (~50ms).

### Sidebar dot palette

`SessionStatusDot` + `aggregateNodeStatus` in
`apps/web/src/components/app-sidebar.tsx` are the canonical
producers.

| State | Color | Class fragment |
|---|---|---|
| Busy (assistant running) | warning amber | `bg-warning` |
| Has pending question or permission | red | `bg-danger` |
| Has error | red | `bg-danger` |
| Idle, has new content since last view | primary | `bg-primary` |
| Idle, fully viewed | (no dot) | n/a |
| Connection lost | gray | `bg-muted-fg/40` |

Pulse animation: `animate-pulse` ONLY on busy/retry states. NEVER on
attention states (we want a stable visual for "needs you").

Sidebar status cascades through every tree level: a question on a
subagent surfaces on its parent main session too. See
`cascadeIdsToAncestors` in `app-sidebar.tsx`.

## Modal / panel state in the URL

Every non-trivial UI surface round-trips through the URL. Paste the
URL into a fresh browser tab → exact same view. No exceptions.

Hooks:

- `useHashOpen(hashId)` (`apps/web/src/hooks/use-hash-open.ts`) for
  boolean open/closed state. Hash format: `#info`, `#settings`.
- `useHashValue<T>(prefix)` for parameterized state. Format:
  `#mcp:redis`, `#files:/abs/path`. URL-encode values.
- Search params (`?server=`, `?focus=`, `?onlyUser=`) for top-level
  filters that survive routes.

Routes that already follow this:

- `/session/:id#msg-<id>` — message permalink
- `/session/:id#info` — session info modal
- `/settings#chat` — settings tab
- `/prompts?focus=<sid>` — focus + flash a specific row

## Loading + async feedback

Per `AGENTS.md > UX preferences > Loading feedback`:

- Components driven by SWR / useSWR: render `<Loader className="size-5" />` while `isLoading && !data`.
- Components driven by ad-hoc fetch: track `loading` boolean.
- Modals: cover body region with centered loader during initial fetch — never render fields with `?? "—"`.
- Lists: spinner row until fetch resolves; "No results found" ONLY after empty response lands.

Per `AGENTS.md > UX preferences > Async-action feedback`:

- Clicks take effect within one paint (disable, swap label, hide input).
- Multi-phase flows update status text per phase ("Asking OpenCode to create..." → "Session created. Sending prompt..." → "Prompt accepted. Opening...").
- Error path restores form + inline error; retry without reload.

## SSE / live state

The single source of truth for indicator state is the SSE stream at
`/api/indicators/stream`. Frontend consumers go through
`useIndicators` / `useIndicator` from
`apps/web/src/hooks/use-indicators.ts`.

NEVER add a new polling SWR hook to read indicator state. NEVER hit
opencode's `/session/status`, `/question`, or `/permission` from the
browser. If you need a new indicator surface, extend
`SessionIndicatorState` in
`apps/web/src/server/lib/indicator-state.ts` and the
`applyOpencodeEvent` handler, then read it via `useIndicator` in the
frontend.

## Per-platform chat icons

`chat-display-store.ts` ships per-icon visibility settings keyed by
platform (`desktop` | `mobile`). Each message / tool-row icon must
gate on `iconVisibility[platform][icon]`:

```tsx
const iconVisibility = useChatDisplayStore((s) => s.iconVisibility);
const { isMobile } = useMediaQuery();
const platform = isMobile ? "mobile" : "desktop";
const showCopyIcon = iconVisibility[platform].copy;

{showCopyIcon && <CopyMarkdownButton text={text} />}
```

Wire-up complete for `MessageItem` (commit `9b2d11e`) and
`ToolCallItem` (commit `ec16261`). New per-row icons MUST extend
this pattern.

## Date / time tokens

The user picks the format in `/settings#chat`. Frontend renders via
`formatMessageTime(ms, dateFormat)` from
`apps/web/src/lib/format-time.ts`. NEVER call `toLocaleString()` /
`toLocaleDateString()` directly in component code — that ignores
the user's setting.

Backend MUST emit dates as either:

- A numeric epoch (ms or s, document which) for the frontend to
  render; or
- ISO-8601 via `new Date().toISOString()` for serialized log /
  archive shapes.

NEVER `toLocaleString()` on the server — the server locale isn't
the user's. The `672e46b` cleanup removed the last violation in
`apps/web/src/server/instances.ts`.

## Comments policy

Priority-3 only: explain non-obvious upstream invariants, security
boundaries, performance optimizations, regex/math/algorithm
intent. NEVER comment what the code obviously says. Use descriptive
identifiers and small named helpers instead of explanatory
comments.

Hard exception: empty `catch {}` blocks MUST carry a comment
explaining why they're empty (per personal AGENTS.md).

## Window title

`document.title` rules:

- On `/session/:id`: `OP: <sessionTitle>` (short prefix, scannable).
- Off-session: `OpenPortal`.

## Browser support

- Mobile target: Android Chrome. iOS auto-zoom is acceptable; do
  not fight it with `font-size:16px` on inputs unless explicitly
  asked.
- Performance target: 1-minute intervals for periodic background
  work on mobile; 10pct step size for any font-size or sizing
  control.

## Per-prompt state badge (composer)

The optimistic chat row carries `_pending.phase` until the real
opencode message replaces it. The badge cycles through a blue
progression deliberately distinct from session-level dot indicators:

| Phase | Border | Background | Text | Label |
|---|---|---|---|---|
| `submitting` | `border-blue-300/40` | `bg-blue-300/15` | `text-blue-600` (light: blue-200 in dark) | Submitting |
| `opencode-accepted` | `border-blue-500/40` | `bg-blue-500/15` | `text-blue-700` (light: blue-300 in dark) | Sent to OpenCode |
| (real message lands) | — | — | — | no badge |

Blue lives in the "this is about THIS PROMPT" lane. Session-status
dots stay yellow (queued / paused), red (stuck-busy / error), green
(completed / done), violet (subsession active). Do not reuse any of
those colors for prompt-journey states.

## Context-usage dial (title bar)

`SessionContextDial` renders a 16px circular progress ring next to
the session title. Math: `r=7, circumference=2*pi*r=43.9823,
stroke-dashoffset = circumference * (1 - tokens/contextLimit)`.

Color tone by saturation:

| Usage | Class |
|---|---|
| `< 0.85` | `text-muted-fg` |
| `>= 0.85` | `text-warning` |
| `>= 0.95` | `text-danger` |

Hidden entirely when there's no active session, no completed
assistant turn, or no declared model context limit.

## Subagent linkage

Subagent sessions (`session.parentID != null`) carry a violet
"Parent" button next to the session-status badge. Violet matches
the existing subsession purple in the Cmd palette; do not use blue
or warning here.

Tone scale for parent button:
- Default: `border-violet-500/40 bg-violet-500/10 text-violet-700`
  (`dark:text-violet-300`).
- Hover: `bg-violet-500/20`.

## Hover affordance on composer selectors

AgentSelect, ModelSelect, ThinkingSelect carry both `aria-label`
AND a native `title=""` so the value shows up on desktop hover.
Mobile ignores title attrs - we don't gate on `isMobile`.

| Selector | title content |
|---|---|
| Agent | `Agent: <name>` or `Select agent` |
| Model | `Model: <id>` (override) or `Use default model` |
| Thinking | `Thinking effort: <variantDisplayLabel(current)>` |

## File-icon palette

`apps/web/src/lib/file-icons.ts getFileIcon(filename, isDir)`
returns `{ Icon, color }` where color is a Tailwind text-* class.
Six icon shapes (Folder, Document, DocumentText, CodeBracket,
CommandLine, Photo/Film/Music, Archive, TableCells, BookOpen,
Cog) with per-extension tint:

| Family | Color band |
|---|---|
| TS/JS | blue / yellow |
| Python | blue |
| Go | cyan |
| Rust | orange |
| Ruby | red |
| CSS / pink | pink |
| HTML / orange | orange |
| YAML/conf | muted/red |
| Image | violet (svg yellow) |
| Video | purple |
| Audio | pink |
| Archive | amber |
| Spreadsheet/SQL | green/emerald/pink |
| LICENSE/COPYING | amber |
| README/CHANGELOG | blue/emerald |
| AGENTS.md | purple |
| Dockerfile | cyan |
| PKGBUILD | blue (Arch) |

Resolution order: directory-by-name -> exact-filename ->
extension -> default DocumentIcon muted-fg.

## Anti-patterns (BLOCK on review)

- New `useSWR` with `refreshInterval > 0` to read indicator-state.
- Server-side `toLocaleString()`.
- `<button onClick={() => navigate}>` masquerading as a link.
- Modal that doesn't round-trip through a URL hash.
- New per-platform setting that doesn't extend `chat-display-store`.
- Raw Tailwind palette colors (`text-red-500`, etc.) for semantic
  intents.
- Arbitrary spacing values when the scale would do.
- Empty `catch {}` without an explaining comment.
- Per-icon affordance without `aria-label` + `title`.
- Comments narrating what the next line literally does.
