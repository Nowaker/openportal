// Client-side resolver for the server's mutation reconciliation overlay.
//
// Sessions returned by /api/opencode/<port>/sessions may carry overlay
// fields (`_pendingArchived`, `_pendingTitle`, ...) set by the portal's
// in-progress mutation queue. The frontend MUST NEVER read the raw
// authoritative field (s.time.archived, s.title, ...) directly - that
// would skip the overlay and show opencode's stale view during the
// 100ms-2s window between a user-fired mutation and opencode catching up.
//
// Architecture doc:
//   ai-analysis-requests/MUTATION_RECONCILIATION_ARCHITECTURE.md
// Server source of truth:
//   apps/web/src/server/lib/session-overlay.ts

export type SessionOverlayValue<T> = {
  value: T;
  setAt: number;
};

export type SessionWithOverlay = {
  id?: string;
  title?: string;
  time?: { archived?: number; [k: string]: unknown };
  _pendingArchived?: SessionOverlayValue<number>;
  _pendingTitle?: SessionOverlayValue<string>;
  [k: string]: unknown;
};

export function effectiveArchivedAt(s: SessionWithOverlay | null | undefined): number {
  if (!s) return 0;
  if (s._pendingArchived?.value !== undefined) return s._pendingArchived.value;
  return (s.time?.archived as number | undefined) ?? 0;
}

export function isEffectivelyArchived(s: SessionWithOverlay | null | undefined): boolean {
  return effectiveArchivedAt(s) > 0;
}

export function effectiveTitle(s: SessionWithOverlay | null | undefined): string | undefined {
  if (!s) return undefined;
  if (s._pendingTitle?.value !== undefined) return s._pendingTitle.value;
  return s.title;
}

// True iff the session has any pending overlay - useful for rendering a
// subtle "syncing" affordance, though v1 doesn't surface this in the UI.
export function hasPendingMutation(s: SessionWithOverlay | null | undefined): boolean {
  if (!s) return false;
  return s._pendingArchived !== undefined || s._pendingTitle !== undefined;
}
