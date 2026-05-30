// Server-side mutation reconciliation layer.
//
// OpenCode's PATCH endpoints are slow and the sessions list only reflects
// the change once opencode's internal write has landed. The user-perceived
// gap from "I clicked Archive" to "the row moved to Archived" was 400ms-2s
// of dead UI. This module is the single source of truth for in-flight
// mutations the user has fired but opencode hasn't reflected yet.
//
// Lifecycle:
//   1. Mutation endpoint (archive/unarchive/rename/...) calls
//      setOverlayField() the instant the request hits portal.
//   2. Endpoint invalidates the sessions cache so the next read re-fetches
//      from opencode with the overlay merged in.
//   3. Endpoint awaits opencode. On error, calls clearOverlayField() to
//      roll back; on success, leaves the overlay in place.
//   4. Every /sessions GET runs through applyOverlay() and reconcile() -
//      reconcile() clears overlay entries whose authoritative value now
//      matches the pending value (opencode caught up).
//   5. Stale safety net: overlays older than RECONCILE_MAX_AGE_MS get
//      cleared even if opencode still disagrees (silent-failure guard).
//
// Per-port keying because each opencode instance has its own session ID
// space. In-memory only - process restart wipes pending state. Acceptable
// because:
//   (a) the mutation either landed in opencode before restart (overlay
//       was right) or didn't (the user can re-click);
//   (b) the sessions cache hydrates from opencode on first read post-
//       restart, which is the authoritative truth at that point.
//
// All overlay fields are prefixed `_pending` so they cannot collide with
// any field opencode might add to its session record in the future.

const RECONCILE_MAX_AGE_MS = 30_000;

export type OverlayValue<T> = {
  value: T;
  setAt: number;
};

export type OverlayState = {
  _pendingArchived?: OverlayValue<number>;
  _pendingTitle?: OverlayValue<string>;
};

export type OverlayField = keyof OverlayState;

type LooseSession = {
  id?: string;
  title?: string;
  time?: { archived?: number; [k: string]: unknown };
  [k: string]: unknown;
};

const overlays = new Map<number, Map<string, OverlayState>>();

function getPortMap(port: number): Map<string, OverlayState> {
  let m = overlays.get(port);
  if (!m) {
    m = new Map();
    overlays.set(port, m);
  }
  return m;
}

export function setOverlayField<F extends OverlayField>(
  port: number,
  sessionId: string,
  field: F,
  value: NonNullable<OverlayState[F]>["value"],
): void {
  const m = getPortMap(port);
  const existing = m.get(sessionId) ?? {};
  const next: OverlayState = { ...existing, [field]: { value, setAt: Date.now() } };
  m.set(sessionId, next);
}

export function clearOverlayField(
  port: number,
  sessionId: string,
  field: OverlayField,
): void {
  const m = overlays.get(port);
  if (!m) return;
  const existing = m.get(sessionId);
  if (!existing) return;
  const next = { ...existing };
  delete next[field];
  if (Object.keys(next).length === 0) {
    m.delete(sessionId);
  } else {
    m.set(sessionId, next);
  }
}

export function clearOverlay(port: number, sessionId: string): void {
  const m = overlays.get(port);
  if (!m) return;
  m.delete(sessionId);
}

export function getOverlay(
  port: number,
  sessionId: string,
): OverlayState | undefined {
  return overlays.get(port)?.get(sessionId);
}

// Merge overlay onto a single session record. Non-destructive: returns a
// shallow copy with overlay fields added. Original opencode fields are
// preserved so the frontend can still see authoritative values if it
// wants to reason about reconciliation state.
export function applyOverlay<S extends LooseSession>(port: number, session: S): S {
  if (!session?.id) return session;
  const overlay = overlays.get(port)?.get(session.id);
  if (!overlay) return session;
  return { ...session, ...overlay };
}

// Called from the /sessions handler after the upstream fetch. Walks each
// returned session and:
//   1. If the overlay field's pending value matches opencode's
//      authoritative value, clear the overlay (mutation has landed).
//   2. If the overlay is older than RECONCILE_MAX_AGE_MS and still doesn't
//      match, clear it anyway and log. Stale fallback - normal flow never
//      hits this branch.
export function reconcile<S extends LooseSession>(
  port: number,
  sessions: S[],
): void {
  const m = overlays.get(port);
  if (!m || m.size === 0) return;
  const now = Date.now();
  for (const s of sessions) {
    if (!s?.id) continue;
    const overlay = m.get(s.id);
    if (!overlay) continue;
    const updated: OverlayState = { ...overlay };
    let changed = false;

    if (overlay._pendingArchived !== undefined) {
      const authoritative = (s.time?.archived as number | undefined) ?? 0;
      const pending = overlay._pendingArchived.value;
      const matches = (pending === 0 && authoritative === 0) || (pending > 0 && authoritative > 0);
      const stale = now - overlay._pendingArchived.setAt > RECONCILE_MAX_AGE_MS;
      if (matches) {
        delete updated._pendingArchived;
        changed = true;
      } else if (stale) {
        console.warn(
          `[session-overlay] dropping stale _pendingArchived for ${s.id}: pending=${pending} authoritative=${authoritative} ageMs=${now - overlay._pendingArchived.setAt}`,
        );
        delete updated._pendingArchived;
        changed = true;
      }
    }

    if (overlay._pendingTitle !== undefined) {
      const authoritative = s.title;
      const pending = overlay._pendingTitle.value;
      const matches = authoritative === pending;
      const stale = now - overlay._pendingTitle.setAt > RECONCILE_MAX_AGE_MS;
      if (matches) {
        delete updated._pendingTitle;
        changed = true;
      } else if (stale) {
        console.warn(
          `[session-overlay] dropping stale _pendingTitle for ${s.id}: pending="${pending}" authoritative="${authoritative}" ageMs=${now - overlay._pendingTitle.setAt}`,
        );
        delete updated._pendingTitle;
        changed = true;
      }
    }

    if (changed) {
      if (Object.keys(updated).length === 0) {
        m.delete(s.id);
      } else {
        m.set(s.id, updated);
      }
    }
  }

  if (m.size === 0) overlays.delete(port);
}
