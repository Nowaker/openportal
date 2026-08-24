import {
  ArrowPathIcon,
  BellAlertIcon,
  ExclamationTriangleIcon,
  ServerStackIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { OpencodeUpdateBanner } from "@/components/opencode-update-banner";
import { RestartOpencodeButton } from "@/components/restart-opencode-button";
import { StuckDetectorInstallBanner } from "@/components/stuck-detector-install-banner";
import { CompactBanner } from "@/components/ui/compact-banner";
import { useBuildMismatch } from "@/hooks/use-build-mismatch";
import { useConnectionMonitor } from "@/hooks/use-connection-monitor";
import { requestNotificationPermission } from "@/hooks/use-status-notifications";
import { logSystemMessage } from "@/stores/system-messages-store";

function ConnectionStatusBanner() {
  const status = useConnectionMonitor();
  if (status === "connected") return null;
  if (status === "opencode-down") {
    return (
      <CompactBanner
        intent="warning"
        icon={<ExclamationTriangleIcon className="size-3.5" aria-hidden />}
        message="OpenCode unreachable - retrying every 10s"
        actions={
          <>
            <RestartOpencodeButton />
            <Link
              to="/servers"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
            >
              <ServerStackIcon className="size-3.5" />
              Servers
            </Link>
          </>
        }
        details={
          <span>
            Cached data still showing. OpenPortal-owned features (prompts
            archive, server list, settings) keep working. Live OpenCode reads
            resume automatically.
          </span>
        }
      />
    );
  }
  return (
    <CompactBanner
      intent="danger"
      icon={<ArrowPathIcon className="size-3.5 animate-spin" aria-hidden />}
      message="OpenPortal lost - reconnecting"
      actions={
        <Link
          to="/servers"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
        >
          <ServerStackIcon className="size-3.5" />
          Servers
        </Link>
      }
      details={
        <span>
          Your prompt drafts and pasted images are saved locally - nothing will
          be lost.
        </span>
      }
    />
  );
}

function BuildMismatchBanner() {
  const mismatch = useBuildMismatch();
  const [reloading, setReloading] = useState(false);
  if (!mismatch.mismatched) return null;
  const incomingSubject = mismatch.incomingCommitSubject;
  const incomingUrl = mismatch.incomingCommitUrl;
  return (
    <CompactBanner
      intent="warning"
      icon={<ArrowPathIcon className="size-3.5" aria-hidden />}
      message={
        incomingSubject
          ? "OpenPortal updated - reload to upgrade."
          : "OpenPortal updated - reload to upgrade"
      }
      actions={
        <>
          {incomingSubject && incomingUrl && (
            <a
              href={incomingUrl}
              target="_blank"
              rel="noreferrer"
              className="max-w-[40vw] truncate rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
              title={incomingSubject}
            >
              Incoming: {incomingSubject}
            </a>
          )}
          <button
            type="button"
            disabled={reloading}
            onClick={() => {
              setReloading(true);
              window.location.reload();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted disabled:opacity-70"
          >
            <ArrowPathIcon
              className={`size-3.5 shrink-0 ${reloading ? "animate-spin" : ""}`}
            />
            {reloading ? "Reloading…" : "Reload"}
          </button>
        </>
      }
    />
  );
}

const NOTIF_DISMISS_KEY = "opencode-notif-prompt-dismissed";

type BannerMode = "default" | "denied" | "hidden";

function NotificationPermissionBanner() {
  const [mode, setMode] = useState<BannerMode>("hidden");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(NOTIF_DISMISS_KEY) === "1";
    } catch {
      // private mode / quota - treat as not dismissed (better to nag than hide)
    }
    if (dismissed) return;
    if (Notification.permission === "default") setMode("default");
    else if (Notification.permission === "denied") setMode("denied");
  }, []);

  if (mode === "hidden") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(NOTIF_DISMISS_KEY, "1");
    } catch {
      // ignore quota / private-mode errors
    }
    setMode("hidden");
  };

  if (mode === "denied") {
    return (
      <CompactBanner
        intent="warning"
        icon={<BellAlertIcon className="size-3.5" aria-hidden />}
        message="Notifications blocked"
        actions={
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md p-0.5 text-warning-subtle-fg/80 hover:bg-warning-subtle-fg/10 hover:text-warning-subtle-fg"
            aria-label="Dismiss"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        }
        details={
          <span>
            Click the lock / tune icon in the address bar → Site settings →
            Notifications → Allow, then reload.
          </span>
        }
      />
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-bg/95 px-3 py-1.5 text-xs">
      <BellAlertIcon className="size-3.5 shrink-0 text-muted-fg" />
      <span className="flex-1 text-fg">Get notified on session events.</span>
      <button
        type="button"
        onClick={async () => {
          const result = await requestNotificationPermission();
          setMode("hidden");
          if (result === "granted") {
            logSystemMessage(
              "notification",
              "success",
              "Browser notifications enabled",
            );
          } else if (result === "denied") {
            logSystemMessage(
              "notification",
              "warning",
              "Browser notifications denied by user",
              "Re-enable via the site's permissions panel; OpenPortal will not re-prompt automatically.",
            );
          }
        }}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
      >
        Enable
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-0.5 text-muted-fg hover:bg-muted hover:text-fg"
        aria-label="Dismiss"
      >
        <XMarkIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function AppShellBanners() {
  return (
    <>
      <BuildMismatchBanner />
      <NotificationPermissionBanner />
      <OpencodeUpdateBanner />
      <StuckDetectorInstallBanner />
      <ConnectionStatusBanner />
    </>
  );
}
