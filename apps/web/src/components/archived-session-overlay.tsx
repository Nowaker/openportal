import * as React from "react";
import { ArchiveBoxXMarkIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { logSystemMessage } from "@/stores/system-messages-store";

interface ArchivedSessionOverlayProps {
  port: number | null;
  sessionId: string | null;
  onUnarchived?: () => void;
}

const ICON_HIDE_HEIGHT_PX = 120;

export function ArchivedSessionOverlay({
  port,
  sessionId,
  onUnarchived,
}: ArchivedSessionOverlayProps) {
  const [busy, setBusy] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [showIcon, setShowIcon] = React.useState(true);

  // Hide the icon when the overlay container is too short to fit it
  // alongside the title + button without cropping. The composer area
  // this overlay covers shrinks on mobile + small viewports, so we
  // observe the actual rendered height instead of guessing by media
  // query.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        setShowIcon(h >= ICON_HIDE_HEIGHT_PX);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      ref={containerRef}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-bg/60 backdrop-blur-[1px] pointer-events-auto px-3 text-center"
      data-test="portal-archived-session-overlay"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg/95 px-3 py-2 shadow-lg">
        {showIcon && (
          <ArchiveBoxXMarkIcon className="size-5 text-muted-fg shrink-0" />
        )}
        <div className="text-xs font-medium">Session archived</div>
        <Button
          size="sm"
          onPress={() => {
            void handleUnarchive();
          }}
          isDisabled={busy}
          data-test="portal-archived-session-unarchive"
        >
          {busy ? "Unarchiving..." : "Unarchive"}
        </Button>
      </div>
    </div>
  );
}
