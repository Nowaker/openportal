import { useCallback, useMemo, useState } from "react";

import { useIndicator, type SessionIndicatorState } from "@/hooks/use-indicators";
import { useInstanceStore } from "@/stores/instance-store";
import { logSystemMessage } from "@/stores/system-messages-store";
import { toast } from "@/components/ui/toast";

type BadgeKind =
  | "error"
  | "stuck"
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

// Priority chain (top first):
//   ERROR > STUCK > QUESTION > PERMISSION > COMPACTING > TOOL > THINKING
//   > QUEUED > none
//
// STUCK comes from the stuck-detector verdict. Its event-stream-based
// `.busy` signal can't detect 'wedged' (by definition no events arrive
// when the runner is stuck). THINKING uses .busy OR
// stuck_verdict === "in-progress" so the badge fires even when opencode
// misses firing message.created.
export function pickBadge(state: SessionIndicatorState | null): BadgeRender | null {
  if (!state) return null;

  if (state.lastError) {
    return {
      kind: "error",
      label: "ERROR",
      className: "bg-danger text-danger-fg",
      title: `Session error: ${state.lastError.slice(0, 200)}`,
    };
  }

  if (state.stuck_verdict === "stuck") {
    return {
      kind: "stuck",
      label: "STUCK",
      className: "bg-danger text-danger-fg animate-pulse",
      title: state.stuck_cause
        ? `Runner appears stuck: ${state.stuck_cause}`
        : "Runner appears stuck (no-runner / stale-stream)",
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
      title: "OpenCode is summarising older history",
    };
  }

  const runtimeBusy = state.busy || state.stuck_verdict === "in-progress";

  if (state.currentToolName && runtimeBusy) {
    return {
      kind: "tool",
      label: `TOOL: ${state.currentToolName}`,
      className: "bg-warning text-warning-fg animate-pulse",
      title: `Running tool: ${state.currentToolName}`,
    };
  }

  if (runtimeBusy) {
    return {
      kind: "thinking",
      label: "THINKING",
      className: "bg-warning text-warning-fg animate-pulse",
      title:
        state.busy
          ? "Assistant is generating"
          : "Runtime is busy (per stuck-detector probe)",
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
  const [unsticking, setUnsticking] = useState(false);

  // STUCK gets a click-to-unstuck affordance; other badges stay passive
  // (span). Posts to /api/stuck-detector/unstuck which forwards to the
  // plugin's /unstuck/<sid>. User invariant: 'STUCK badge present but
  // nothing actionable about it. stuck badge should be clickable, and
  // offer action to unstuck it.'
  const onUnstuck = useCallback(async () => {
    if (unsticking) return;
    const cause = indicator?.stuck_cause ?? "manual-from-badge";
    const ok = window.confirm(
      `Unstuck this session?\n\nReason: ${cause}\n\nThis tells the stuck-detector plugin to abort the wedged runner. The session itself stays; only the stuck runner is killed.`,
    );
    if (!ok) return;
    setUnsticking(true);
    try {
      const res = await fetch("/api/stuck-detector/unstuck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionID: sessionId, cause }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        status?: number;
      } | null;
      if (res.ok && body?.ok) {
        toast.success("Unstuck dispatched");
        logSystemMessage(
          "stuck-detector",
          "success",
          "Unstuck dispatched from STUCK badge",
          `Session: ${sessionId}\nCause: ${cause}`,
          undefined,
          sessionId,
        );
      } else {
        const err = body?.error ?? `HTTP ${res.status}`;
        toast.error(`Unstuck failed: ${err}`);
        logSystemMessage(
          "stuck-detector",
          "error",
          "Unstuck request failed",
          `Session: ${sessionId}\nError: ${err}`,
          undefined,
          sessionId,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network error";
      toast.error(`Unstuck failed: ${msg}`);
    } finally {
      setUnsticking(false);
    }
  }, [indicator?.stuck_cause, sessionId, unsticking]);

  if (!badge) return null;

  const sharedClass = `inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide leading-4 whitespace-nowrap ${badge.className} ${extraClassName}`;

  if (badge.kind === "stuck") {
    return (
      <button
        type="button"
        onClick={onUnstuck}
        disabled={unsticking}
        title={`${badge.title}\nClick to dispatch unstuck.`}
        aria-label={`${badge.title} - click to unstuck`}
        className={`${sharedClass} cursor-pointer hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60 disabled:cursor-wait`}
        data-test="portal-session-status-badge-stuck"
      >
        {unsticking ? "UNSTICKING..." : badge.label}
      </button>
    );
  }

  return (
    <span
      title={badge.title}
      aria-label={badge.title}
      className={sharedClass}
    >
      {badge.label}
    </span>
  );
}
