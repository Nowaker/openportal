// Title-bar badge for the actively-viewed session. Thin wrapper around
// the shared status module in lib/session-status.tsx: this file picks
// the priority-winning status from the live indicator state, then renders
// the long-form badge via <StatusBadge>. The STUCK kind gets a click-to-
// unstuck button affordance; all other kinds render as a passive <span>.

import { useCallback, useMemo, useState } from "react";

import { useIndicator } from "@/hooks/use-indicators";
import { useInstanceStore } from "@/stores/instance-store";
import { logSystemMessage } from "@/stores/system-messages-store";
import { toast } from "@/components/ui/toast";
import {
  pickBadgeStatus,
  STATUS_VISUALS,
  STATUS_DEFAULTS,
} from "@/lib/session-status";
import { StatusBadge } from "@/lib/session-status-render";

// Re-export the picker for the test file (which used to import `pickBadge`
// from this module). Keeps the test entrypoint stable.
export { pickBadgeStatus as pickBadge } from "@/lib/session-status";
export type { StatusKind, StatusInfo } from "@/lib/session-status";

export function SessionStatusBadge({
  sessionId,
  archived = false,
  className: extraClassName = "",
}: {
  sessionId: string;
  archived?: boolean;
  className?: string;
}) {
  const instance = useInstanceStore((s) => s.instance);
  const serverId = instance?.id;
  const indicator = useIndicator(serverId, sessionId);
  const status = useMemo(() => pickBadgeStatus(indicator), [indicator]);
  const [unsticking, setUnsticking] = useState(false);

  // STUCK gets a click-to-unstuck affordance; every other kind stays
  // passive (span). User invariant: "STUCK badge present but nothing
  // actionable about it. stuck badge should be clickable, and offer
  // action to unstuck it."
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

  if (!status) return null;
  if (archived) return null;

  if (status.kind === "stuck") {
    const v = STATUS_VISUALS.stuck;
    // Manually compose the button so we keep the clickable affordances
    // (focus ring, disabled cursor, hover brightness) that <StatusBadge>
    // doesn't apply. The base classes mirror <StatusBadge>'s pill shape
    // for visual consistency.
    const baseCls = `inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide leading-4 whitespace-nowrap ${v.bg} ${v.badgeFg} animate-pulse cursor-pointer hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60 disabled:cursor-wait ${extraClassName}`;
    return (
      <button
        type="button"
        onClick={onUnstuck}
        disabled={unsticking}
        title={`${status.title}\nClick to dispatch unstuck.`}
        aria-label={`${status.title} - click to unstuck`}
        className={baseCls}
        data-test="portal-session-status-badge-stuck"
        data-status-kind="stuck"
      >
        {unsticking ? "UNSTICKING..." : status.label}
      </button>
    );
  }

  return (
    <StatusBadge
      kind={status.kind}
      label={status.label}
      title={status.title}
      className={extraClassName}
    />
  );
}

// Suppress unused-import warning for STATUS_DEFAULTS - it's exported via
// the re-export above for backward compat (was implicitly part of the
// public surface via badge.label and badge.title fields).
void STATUS_DEFAULTS;
