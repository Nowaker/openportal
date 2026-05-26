import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import { PencilSquareIcon } from "@heroicons/react/24/outline";

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

// In sidebar contexts, absent indicators STILL render a fixed-width
// placeholder so titles align across tree rows (reserveSpace=true). In
// pinned-tab contexts where each tab is independent and width-fluid,
// reserveSpace=false collapses absent indicators to render nothing.
//
// Priority chain (top to bottom):
//   1. hasError                 -> red (own attention OR bubbled-up child
//      error). Error wins over question because errors require user
//      intervention beyond just answering.
//   2. hasQuestion              -> sky-blue PULSING. AI is waiting on your
//      answer - this is high-priority but distinct from errors. Pulse
//      because it's actively blocking the session, distinct from busy
//      (amber pulse) and error (red, no pulse).
//   3. status busy/retry        -> amber for top-level sessions, violet-pulse
//      for subagents (subagent=true). Subagents share the same color as the
//      parent's "child running" indicator so the running state is visually
//      one continuous signal across the parent and its children.
//   4. hasChildBusy             -> violet-pulse ("subsession in progress" - any
//      child session of this one is busy/retry, but this session itself is idle)
//   5. hasNewContent            -> violet steady (review-me) for TOP-LEVEL ONLY.
//      Suppressed for subagents: their finished state = no indicator at all.
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
  if (hasError) {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-red-500"
        aria-label="Session has error"
        title="Session has error"
      />
    );
  }
  if (hasQuestion) {
    return (
      <span
        className="relative flex size-2 shrink-0"
        aria-label="AI is waiting on your answer"
        title="AI is waiting on your answer"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
      </span>
    );
  }
  if (status === "busy") {
    if (subagent) {
      return (
        <span
          className="relative flex size-2 shrink-0"
          aria-label="Subagent running"
          title="Subagent running"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
        </span>
      );
    }
    return (
      <span
        className="relative flex size-2 shrink-0"
        aria-label="Session is running"
        title="Session is running"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
      </span>
    );
  }
  if (status === "retry") {
    if (subagent) {
      return (
        <span
          className="size-2 shrink-0 rounded-full bg-violet-600"
          aria-label="Subagent retrying"
          title="Subagent retrying"
        />
      );
    }
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-amber-600"
        aria-label="Session is retrying"
        title="Session is retrying"
      />
    );
  }
  if (hasChildBusy) {
    return (
      <span
        className="relative flex size-2 shrink-0"
        aria-label="Subsession in progress"
        title="Subsession in progress"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
      </span>
    );
  }
  if (hasNewContent && !subagent) {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-violet-500"
        aria-label="Task complete - review needed"
        title="Task complete - review needed"
      />
    );
  }
  if (!reserveSpace) return null;
  return <span className="size-2 shrink-0" aria-hidden />;
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
