import * as React from "react";
import { ArchiveBoxXMarkIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { logSystemMessage } from "@/stores/system-messages-store";

// Per AI_TODO.md #29: when the active session is archived, the composer
// stays visible (so the layout matches the active-session view) but is
// non-interactive. This overlay covers the composer area with a centered
// notice + Unarchive button. The composer underneath gets pointer-events-
// none via the parent's archived flag handling; this overlay opts itself
// back in for the button.

interface ArchivedSessionOverlayProps {
  port: number | null;
  sessionId: string | null;
  onUnarchived?: () => void;
}

export function ArchivedSessionOverlay({
  port,
  sessionId,
  onUnarchived,
}: ArchivedSessionOverlayProps) {
  const [busy, setBusy] = React.useState(false);

  const handleUnarchive = async () => {
    if (!port || !sessionId) return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/opencode/${port}/session/${encodeURIComponent(sessionId)}/unarchive`,
        { method: "POST" },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        const err = body?.error ?? `Unarchive failed (HTTP ${r.status}).`;
        toast.error(err);
        logSystemMessage("other", "error", "Unarchive failed", err);
        return;
      }
      toast.success("Session unarchived.");
      logSystemMessage("other", "success", "Session unarchived");
      onUnarchived?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unarchive request failed.";
      toast.error(msg);
      logSystemMessage("other", "error", "Unarchive request errored", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/60 backdrop-blur-[1px] pointer-events-auto px-4 text-center"
      data-test="portal-archived-session-overlay"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg/95 px-5 py-4 shadow-lg">
        <ArchiveBoxXMarkIcon className="size-7 text-muted-fg" />
        <div className="space-y-1">
          <div className="text-sm font-semibold">Session archived</div>
          <div className="text-xs text-muted-fg max-w-md">
            Controls below stay visible for reference. Unarchive to continue.
          </div>
        </div>
        <Button
          size="sm"
          onPress={() => {
            void handleUnarchive();
          }}
          isDisabled={busy}
          data-test="portal-archived-session-unarchive"
        >
          {busy ? "Unarchiving..." : "Unarchive session"}
        </Button>
      </div>
    </div>
  );
}
