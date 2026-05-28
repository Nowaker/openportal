import * as React from "react";
import { ArchiveBoxXMarkIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { logSystemMessage } from "@/stores/system-messages-store";

interface ArchivedSessionBannerProps {
  port: number | null;
  sessionId: string | null;
  onUnarchived?: () => void;
}

// Slim banner that renders at the TOP of the composer wrapper when the
// session is archived. Replaces an earlier full-overlay design — the
// composer underneath stays VISIBLE so the user sees the controls they
// would normally interact with. The surrounding wrapper applies
// `opacity-60 pointer-events-none` to make the disabled state explicit
// without hiding the chrome.
//
// This banner itself is `pointer-events-auto` so the Unarchive button
// stays clickable even when the rest of the composer is non-interactive.
export function ArchivedSessionOverlay({
  port,
  sessionId,
  onUnarchived,
}: ArchivedSessionBannerProps) {
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
      const msg =
        err instanceof Error ? err.message : "Unarchive request failed.";
      toast.error(msg);
      logSystemMessage("other", "error", "Unarchive request errored", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="pointer-events-auto shrink-0 flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5"
      data-test="portal-archived-session-banner"
      role="status"
      aria-live="polite"
    >
      <ArchiveBoxXMarkIcon className="size-4 text-warning shrink-0" />
      <span className="text-xs font-medium text-fg flex-1 min-w-0 truncate">
        This session is archived. Unarchive it to send new prompts.
      </span>
      <Button
        size="sm"
        onPress={() => {
          void handleUnarchive();
        }}
        isDisabled={busy}
        data-test="portal-archived-session-unarchive"
        className="shrink-0"
      >
        {busy ? "Unarchiving..." : "Unarchive"}
      </Button>
    </div>
  );
}
