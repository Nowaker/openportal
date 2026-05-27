import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import { PencilSquareIcon } from "@heroicons/react/24/outline";

import { pickSidebarStatus } from "@/lib/session-status";
import { StatusDot as UnifiedStatusDot } from "@/lib/session-status-render";

// Composer-draft storage. Persisting the in-progress text of the
// composer textarea so the user doesn't lose work navigating away.
// Single source of truth - both the per-session composer ($id.tsx) and
// the new-session composer (routes/_app/session/new.tsx) read/write
// these keys via the helpers below. The new-session composer uses
// `newSessionDraftKey(directory)` as the "session id" argument, which
// resolves to `opencode-composer-draft:new:<directory>` - same storage
// shape, same helpers, no duplication.
const DRAFT_KEY_PREFIX = "opencode-composer-draft:";
const NEW_SESSION_DRAFT_PREFIX = "new:";

// Drafts shorter than this only persist when there's NO existing prior
// draft for the same key. Prevents a second tab mounting with an
// empty/short textarea and clobbering the first tab's longer draft.
export const DRAFT_MIN_BYTES = 10;

export function getDraftKey(sessionId: string): string {
  return `${DRAFT_KEY_PREFIX}${sessionId}`;
}

// Synthetic "session id" for the new-session composer at a given
// directory. Returned value is meant to be passed to the same
// getDraftKey/readDraft/writeDraft/sessionHasDraft helpers that real
// session ids go through.
export function newSessionDraftKey(directory: string): string {
  return `${NEW_SESSION_DRAFT_PREFIX}${directory}`;
}

export function readDraft(sessionId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(getDraftKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(sessionId: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(getDraftKey(sessionId), value);
    } else {
      window.localStorage.removeItem(getDraftKey(sessionId));
    }
  } catch {
    // localStorage can throw under quota / privacy modes; the draft is
    // best-effort, never a hard requirement.
  }
}

export function sessionHasDraft(sessionId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(getDraftKey(sessionId));
    return Boolean(v && v.length > 0);
  } catch {
    return false;
  }
}

// Last-viewed source-of-truth is the server (~/.openportal-state.json), not
// localStorage - drafts of which device/tab last viewed a session need to
// sync across devices so the green "review needed" dot clears everywhere
// once the user actually reviews on any one of them.
export function sessionHasNewContent(
  session: Session,
  lastViewedMap: Record<string, number> | undefined,
  currentSessionId?: string | null,
): boolean {
  if (session.id === currentSessionId) return false;
  const updated = session.time?.updated ?? 0;
  if (!updated) return false;
  const lastViewed = lastViewedMap?.[session.id] ?? 0;
  return updated > lastViewed;
}

// Thin wrapper around the shared status picker + renderer. Translates
// the legacy sidebar prop shape (status / hasNewContent / hasQuestion /
// hasError / hasChildBusy / subagent) into a StatusInfo via
// pickSidebarStatus(), then defers to <UnifiedStatusDot> for the actual
// pixel-level rendering.
//
// Layout invariant: in tree contexts (reserveSpace=true) absent
// indicators still render a fixed-width placeholder so titles align
// across rows. In pin/tile contexts (reserveSpace=false) absent
// indicators collapse to render nothing.
//
// Priority chain + color choices live in @/lib/session-status. Changes
// to the visual map (e.g. "DONE is now green") belong there, not here.
export function SessionStatusDot({
  status,
  hasNewContent,
  hasQuestion,
  hasError,
  hasChildBusy,
  reserveSpace = true,
  subagent = false,
}: {
  status: "busy" | "retry" | "idle" | undefined;
  hasNewContent: boolean;
  hasQuestion?: boolean;
  hasError?: boolean;
  hasChildBusy?: boolean;
  reserveSpace?: boolean;
  subagent?: boolean;
}) {
  const pick = pickSidebarStatus({
    status,
    hasError,
    hasQuestion,
    hasChildBusy,
    hasNewContent,
    subagent,
  });

  if (!pick) {
    if (!reserveSpace) return null;
    return <span className="size-2 shrink-0" aria-hidden />;
  }

  return <UnifiedStatusDot kind={pick.kind} title={pick.title} />;
}

export function DraftIndicator({
  hasDraft,
  reserveSpace = true,
}: {
  hasDraft: boolean;
  reserveSpace?: boolean;
}) {
  if (!hasDraft) {
    if (!reserveSpace) return null;
    return <span className="size-3 shrink-0" aria-hidden />;
  }
  return (
    <PencilSquareIcon
      className="size-3 shrink-0 text-sky-500"
      aria-label="Unsent draft"
      title="Unsent draft"
    />
  );
}
