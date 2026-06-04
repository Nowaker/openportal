---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:21:41-05:00
legacy_number: 32
commits:
  attributed:
    - e08807bb03cd
  on_main:
    - e08807bb03cd
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# System messages: kill floating icon, dual entry points, project filter, audit-log enrichment, localStorage persistence

User prompt (refined version, supersedes the briefer mention in #31):

> Enqueue: System messages icon floating randomly. Delete it. Have it go to top right jak hamburger (when open, notifications scoped to current project + system notifications are shown). In left sidebar bottom drop-down menu - when open, no filter (all projects + system). The server has been running long and nothing is in the log. Consider it audit log for important thing, plus anything that is. Shown in a flash message that disappears, or stuff like lost connection, regain connection, new version detected (current x, found on backend y) etc. Reason about what should vo there.

Design notes:
- Two entry points with different default filters:
  - Top-right hamburger (`app-sidebar-nav.tsx`): opens via `useSystemMessagesStore.getState().openProjectFiltered(currentSession?.directory ?? null)`. Drawer shows messages whose `projectDirectory` matches the current session's directory PLUS all system-wide messages (those with no projectDirectory).
  - Left-sidebar bottom dropdown (`app-sidebar.tsx`): opens via `openUnfiltered()`. Drawer shows everything.
- `SystemMessage` interface gains optional `projectDirectory?: string | null` field. Project-scoped events (archive, move, install for one session) pass the directory; system-wide events (connection, version, restart targeting the portal itself) omit it.
- Drawer converts from a bottom-left fixed-position panel to a centered react-aria Modal with fixed-header + scrollable-body + fixed-footer (same pattern as ConfirmDialog).
- Unread-count badge surfaces on both menu entry points so the trigger isn't invisible after a transient event.
- Connection-event wiring in `use-connection-monitor.ts`: every state transition mirrors to the drawer via `logSystemMessage("connection", level, message, details)`:
  - `connected -> openportal-down` → error "OpenPortal disconnected"
  - `connected -> opencode-down` → warning "OpenCode unreachable"
  - `any -> connected` → success "OpenPortal/OpenCode reconnected" (or generic "Connection restored")
- Reasoning about what else belongs in the audit log (deferred to follow-ups): version mismatch (asset hash on backend differs from loaded), stuck-detector verdict transitions, auto-approve toggles, move-to-project completions, session compact completions, notification permission flips, pinned-session add/remove. Out of scope for this iteration; documented in chat.
- v2 follow-up CLOSED (e73c186 + 1951807): localStorage persistence + cross-tab sync. Ring buffer persists to `openportal-system-messages-v1` key on every mutation; module hydrates from disk at load. `storage` window-event listener re-hydrates the in-memory buffer when another tab writes. Defensive try/catch on both read + write so SSR / private mode / sandboxed iframes / corrupted JSON / quota-exceeded all degrade to in-memory-only operation rather than crashing the app shell. Schema-version suffix (-v1) enables future shape migrations.
