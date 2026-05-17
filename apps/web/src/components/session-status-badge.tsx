import { useMemo } from "react";

import { useIndicator, type SessionIndicatorState } from "@/hooks/use-indicators";
import { useInstanceStore } from "@/stores/instance-store";

// Priority-selected status badge that surfaces the most-actionable
// runtime state for a session, sourced exclusively from the SSE
// indicator broadcaster (apps/web/src/server/lib/indicator-state.ts).
//
// Priority chain (top first):
//   ERROR > QUESTION > PERMISSION > COMPACTING > TOOL > THINKING
//   > QUEUED > none
//
// Colors track the sidebar dot palette already established for these
// states: danger for ERROR, sky for QUESTION/PERMISSION, violet for
// COMPACTING, warning for TOOL/THINKING, muted for QUEUED.

type BadgeKind =
  | "error"
  | "question"
  | "permission"
  | "compacting"
  | "tool"
  | "thinking"
  | "queued"
  | null;

interface BadgeRender {
  kind: BadgeKind;
  label: string;
  className: string;
  title: string;
}

function pickBadge(state: SessionIndicatorState | null): BadgeRender | null {
  if (!state) return null;

  if (state.lastError) {
    return {
      kind: "error",
      label: "ERROR",
      className: "bg-danger text-danger-fg",
      title: `Session error: ${state.lastError.slice(0, 200)}`,
    };
  }

  if (state.pendingQuestionIds.length > 0) {
    return {
      kind: "question",
      label: "QUESTION",
      className: "bg-sky-500 text-white animate-pulse",
      title: "Assistant is asking a question",
    };
  }

  if (state.pendingPermissionIds.length > 0) {
    return {
      kind: "permission",
      label: "PERMISSION",
      className: "bg-sky-500 text-white animate-pulse",
      title: "Awaiting your permission to run a tool",
    };
  }

  if (state.mode === "compaction") {
    return {
      kind: "compacting",
      label: "COMPACTING",
      className: "bg-violet-500 text-white animate-pulse",
      title: "opencode is summarising older history",
    };
  }

  if (state.currentToolName && state.busy) {
    return {
      kind: "tool",
      label: `TOOL: ${state.currentToolName}`,
      className: "bg-warning text-warning-fg animate-pulse",
      title: `Running tool: ${state.currentToolName}`,
    };
  }

  if (state.busy) {
    return {
      kind: "thinking",
      label: "THINKING",
      className: "bg-warning text-warning-fg animate-pulse",
      title: "Assistant is generating",
    };
  }

  if (state.pendingPromptIds.length > 0) {
    return {
      kind: "queued",
      label: "QUEUED",
      className: "bg-muted text-muted-fg",
      title: `${state.pendingPromptIds.length} prompt${state.pendingPromptIds.length === 1 ? "" : "s"} waiting for opencode`,
    };
  }

  return null;
}

export function SessionStatusBadge({
  sessionId,
  className: extraClassName = "",
}: {
  sessionId: string;
  className?: string;
}) {
  const instance = useInstanceStore((s) => s.instance);
  const serverId = instance?.id;
  const indicator = useIndicator(serverId, sessionId);
  const badge = useMemo(() => pickBadge(indicator), [indicator]);
  if (!badge) return null;
  return (
    <span
      title={badge.title}
      aria-label={badge.title}
      className={`inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide leading-4 whitespace-nowrap ${badge.className} ${extraClassName}`}
    >
      {badge.label}
    </span>
  );
}
