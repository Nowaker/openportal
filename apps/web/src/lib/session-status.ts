// Unified session-status indicator system. ONE source of truth for the
// visual vocabulary shared between:
//
//   - Title-bar badge (long form, label + colored background) used in the
//     active-session header. Rendered by <SessionStatusBadge>.
//   - Sidebar / pinned-tab dot (short form, ~8px colored circle) used in
//     every session row, project header, pinned tab, and rail tile.
//     Rendered by <SessionStatusDot>.
//
// Before this module, the two surfaces drifted apart: the badge used the
// semantic tokens (bg-danger / bg-warning / bg-muted) while the dot used
// raw Tailwind palette classes, and several states collapsed onto the
// same color (compacting + subagent-busy + child-busy + review-needed all
// landed on violet-500). The user asked us to (a) unify the rendering so
// dot and badge share a state vocabulary, (b) make every state visually
// distinguishable, and (c) render "task complete - review needed" in
// green instead of violet.
//
// Priority chain (top wins, applies to BOTH surfaces):
//
//   1. error             - red, solid          (own session OR child has lastError)
//   2. stuck             - red, pulsing        (stuck_verdict === "stuck")
//   3. question          - sky-blue, pulsing   (pendingQuestionIds > 0)
//   4. permission        - sky-blue, pulsing   (pendingPermissionIds > 0)
//   5. compacting        - fuchsia, pulsing    (mode === "compaction")
//   6. retry             - orange, solid       (opencode_retry !== null;
//                                               opencode itself told us it's
//                                               retrying. Surfaces BEFORE
//                                               tool/thinking because the
//                                               retry attempt is the most
//                                               informative status while it
//                                               persists - "thinking" would
//                                               be a less-useful overlap)
//   7. tool: <name>      - amber, pulsing      (busy + currentToolName)
//   8. thinking          - amber, pulsing      (busy without tool name)
//   9. subagent-busy     - violet, pulsing     (a subagent of this row is busy,
//                                               OR this row IS a busy subagent)
//   10. queued           - slate, solid        (pendingPromptIds > 0)
//   11. review-needed    - emerald (GREEN!), solid (sidebar only - session
//                                               finished while not looking)
//
// Color choices (every state must be distinguishable at a glance):
//
//   - red   - stop / attention required (error, stuck)
//   - sky   - "needs your input" (question, permission)
//   - fuchsia - compacting (was violet - moved to fuchsia so it does NOT
//               collide with subagent-busy violet)
//   - amber - "AI actively working" (tool, thinking)
//   - orange - retry (was amber-600 - moved to orange-600 so retry doesn't
//              look like a darker shade of "busy" amber)
//   - violet - subagent activity (the parent + child running state remains
//              visually continuous via violet across both)
//   - emerald - DONE (was violet steady - moved to green per user spec)
//   - slate - queued / parked

import type { SessionIndicatorState } from "@/hooks/use-indicators";

// =============================================================================
// State vocabulary
// =============================================================================

export type StatusKind =
  | "error"
  | "stuck"
  | "question"
  | "permission"
  | "compacting"
  | "tool"
  | "thinking"
  | "retry"
  | "subagent-busy"
  | "queued"
  | "review-needed";

// Visual map. ONE source of truth for color/animation per state. Both
// the dot variant and the badge variant pull their classes from here so
// the two surfaces are guaranteed to look identical for the same state.
interface StatusVisual {
  // Solid bg color used by both badge body and dot core.
  bg: string;
  // Text color paired with `bg` in badge form.
  badgeFg: string;
  // Ping ring color for the dot's animate-ping overlay (matches `bg`'s
  // family one notch lighter). Empty string = no pulse for dot.
  ping: string;
  // True = badge gets `animate-pulse`; dot gets the ping overlay.
  pulse: boolean;
}

export const STATUS_VISUALS: Record<StatusKind, StatusVisual> = {
  error: {
    bg: "bg-red-500",
    badgeFg: "text-white",
    ping: "",
    pulse: false,
  },
  stuck: {
    bg: "bg-red-500",
    badgeFg: "text-white",
    ping: "bg-red-400",
    pulse: true,
  },
  question: {
    bg: "bg-sky-500",
    badgeFg: "text-white",
    ping: "bg-sky-400",
    pulse: true,
  },
  permission: {
    bg: "bg-sky-500",
    badgeFg: "text-white",
    ping: "bg-sky-400",
    pulse: true,
  },
  compacting: {
    bg: "bg-fuchsia-500",
    badgeFg: "text-white",
    ping: "bg-fuchsia-400",
    pulse: true,
  },
  tool: {
    bg: "bg-amber-500",
    badgeFg: "text-white",
    ping: "bg-amber-400",
    pulse: true,
  },
  thinking: {
    bg: "bg-amber-500",
    badgeFg: "text-white",
    ping: "bg-amber-400",
    pulse: true,
  },
  retry: {
    bg: "bg-orange-600",
    badgeFg: "text-white",
    ping: "",
    pulse: false,
  },
  "subagent-busy": {
    bg: "bg-violet-500",
    badgeFg: "text-white",
    ping: "bg-violet-400",
    pulse: true,
  },
  queued: {
    bg: "bg-slate-400",
    badgeFg: "text-white",
    ping: "",
    pulse: false,
  },
  "review-needed": {
    bg: "bg-emerald-500",
    badgeFg: "text-white",
    ping: "",
    pulse: false,
  },
};

// Default labels and tooltips. The picker functions may override these
// (e.g. "TOOL: bash" with the actual tool name).
export const STATUS_DEFAULTS: Record<StatusKind, { label: string; title: string }> = {
  error: { label: "ERROR", title: "Session has an error" },
  stuck: { label: "STUCK", title: "Runner appears stuck (no-runner / stale-stream)" },
  question: { label: "QUESTION", title: "Assistant is asking a question" },
  permission: { label: "PERMISSION", title: "Awaiting your permission to run a tool" },
  compacting: { label: "COMPACTING", title: "OpenCode is summarising older history" },
  tool: { label: "TOOL", title: "AI is running a tool" },
  thinking: { label: "THINKING", title: "Assistant is generating a response" },
  retry: { label: "RETRY", title: "Transient error - opencode is retrying" },
  "subagent-busy": { label: "SUBAGENT", title: "A subagent is running" },
  queued: { label: "QUEUED", title: "Prompts are queued waiting for opencode" },
  "review-needed": { label: "DONE", title: "Task complete - review needed" },
};

export interface StatusInfo {
  kind: StatusKind;
  label: string;
  title: string;
}

// =============================================================================
// Pickers - input -> StatusInfo
// =============================================================================

// Title-bar badge picker. Operates on the SessionIndicatorState (from
// /api/indicators/stream) for the actively-viewed session. The badge does
// NOT surface "review-needed" (the user is already viewing the session,
// so by definition there is nothing left to review). It DOES surface
// retry and subagent-busy in addition to the legacy 8 states so the
// title-bar carries the same vocabulary as the sidebar.
export function pickBadgeStatus(state: SessionIndicatorState | null): StatusInfo | null {
  if (!state) return null;

  if (state.lastError) {
    return {
      kind: "error",
      label: STATUS_DEFAULTS.error.label,
      title: `Session error: ${state.lastError.slice(0, 200)}`,
    };
  }

  if (state.stuck_verdict === "stuck") {
    return {
      kind: "stuck",
      label: STATUS_DEFAULTS.stuck.label,
      title: state.stuck_cause
        ? `Runner appears stuck: ${state.stuck_cause}`
        : STATUS_DEFAULTS.stuck.title,
    };
  }

  if (state.pendingQuestionIds.length > 0) {
    return { kind: "question", ...STATUS_DEFAULTS.question };
  }

  if (state.pendingPermissionIds.length > 0) {
    return { kind: "permission", ...STATUS_DEFAULTS.permission };
  }

  if (state.mode === "compaction") {
    return { kind: "compacting", ...STATUS_DEFAULTS.compacting };
  }

  if (state.opencode_retry) {
    const r = state.opencode_retry;
    const remainingMs = Math.max(0, r.next - Date.now());
    const sec = Math.ceil(remainingMs / 1000);
    const countdown =
      sec >= 60
        ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`
        : `${sec}s`;
    const titleParts = [
      `Attempt ${r.attempt}`,
      r.message,
      r.next > 0 ? `Next attempt in ${countdown}` : null,
      r.action?.title ?? null,
    ].filter(Boolean);
    return {
      kind: "retry",
      label: `RETRY ${r.attempt}`,
      title: titleParts.join(" - "),
    };
  }

  const runtimeBusy = state.busy || state.stuck_verdict === "in-progress";

  if (state.currentToolName && runtimeBusy) {
    return {
      kind: "tool",
      label: `TOOL: ${state.currentToolName}`,
      title: `Running tool: ${state.currentToolName}`,
    };
  }

  if (runtimeBusy) {
    return {
      kind: "thinking",
      label: STATUS_DEFAULTS.thinking.label,
      title: state.busy
        ? "Assistant is generating"
        : "Runtime is busy (per stuck-detector probe)",
    };
  }

  if (state.pendingPromptIds.length > 0) {
    return {
      kind: "queued",
      label: STATUS_DEFAULTS.queued.label,
      title: `${state.pendingPromptIds.length} prompt${state.pendingPromptIds.length === 1 ? "" : "s"} waiting for opencode`,
    };
  }

  return null;
}

// Sidebar dot picker. The sidebar carries aggregated, tree-cascaded
// inputs (a project header rolls up its children's state, a session row
// rolls up its subagents' state). The legacy sidebar code only passed a
// subset of inputs through to the dot - this picker accepts the FULL
// vocabulary so future enhancements can wire in stuck / compacting /
// permission for free, but the current call sites pass only what they
// already track. Defaults preserve the legacy priority chain.
export interface SidebarStatusInput {
  // Own-session indicator status from /api/sessions/<sid>/status.
  status?: "busy" | "retry" | "idle";
  hasError?: boolean;
  hasQuestion?: boolean;
  hasPermission?: boolean;
  hasStuck?: boolean;
  hasCompacting?: boolean;
  // True when an in-tree child of this row is busy/retry but the row
  // itself isn't. Combined with `subagent` below to figure out which
  // visual to show.
  hasChildBusy?: boolean;
  // True if this dot represents a subagent row itself (not a top-level
  // session). Combined with `status` to decide between own-row-busy
  // (top-level => amber legacy, now distinct from retry) vs subagent-busy.
  subagent?: boolean;
  // True if the session has new activity since the user last viewed it.
  // Only shown on top-level rows; subagents don't get a review-needed
  // indicator (their "completion" is signaled by clearing the dot).
  hasNewContent?: boolean;
}

export function pickSidebarStatus(input: SidebarStatusInput): StatusInfo | null {
  if (input.hasError) return { kind: "error", ...STATUS_DEFAULTS.error };
  if (input.hasStuck) return { kind: "stuck", ...STATUS_DEFAULTS.stuck };
  if (input.hasQuestion) return { kind: "question", ...STATUS_DEFAULTS.question };
  if (input.hasPermission) return { kind: "permission", ...STATUS_DEFAULTS.permission };
  if (input.hasCompacting) return { kind: "compacting", ...STATUS_DEFAULTS.compacting };

  if (input.status === "busy") {
    // Subagent row that's busy OR a top-level row whose child is busy:
    // BOTH paint as subagent-busy (violet) so the parent/child running
    // state reads as one continuous signal across the tree.
    if (input.subagent) {
      return { kind: "subagent-busy", ...STATUS_DEFAULTS["subagent-busy"] };
    }
    return { kind: "thinking", label: STATUS_DEFAULTS.thinking.label, title: "Session is running" };
  }

  if (input.status === "retry") {
    return { kind: "retry", ...STATUS_DEFAULTS.retry };
  }

  if (input.hasChildBusy) {
    return { kind: "subagent-busy", label: STATUS_DEFAULTS["subagent-busy"].label, title: "Subsession in progress" };
  }

  if (input.hasNewContent && !input.subagent) {
    return { kind: "review-needed", ...STATUS_DEFAULTS["review-needed"] };
  }

  return null;
}

// Ordered list of all states for showcase rendering (Settings ->
// Diagnostics) and other "enumerate everything" callers. Order matches
// the priority chain documented at the top of this module.
export const STATUS_SHOWCASE_ORDER: StatusKind[] = [
  "error",
  "stuck",
  "question",
  "permission",
  "compacting",
  "tool",
  "thinking",
  "retry",
  "subagent-busy",
  "queued",
  "review-needed",
];

// Rendering primitives <StatusDot> / <StatusBadge> / <StatusIndicator>
// live in @/lib/session-status-render so this file stays JSX-free and
// can be imported from bun unit tests without dragging in
// react/jsx-dev-runtime.
