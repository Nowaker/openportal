import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  BellAlertIcon,
  ServerStackIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import AppSidebar from "@/components/app-sidebar";
import { AppSidebarNav, PinnedTabStrip } from "@/components/app-sidebar-nav";
import { FileBrowserPanel } from "@/components/file-browser-panel";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { useInstanceStore } from "@/stores/instance-store";
import { useSelfInstance } from "@/hooks/use-opencode";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useBuildMismatch } from "@/hooks/use-build-mismatch";
import { useConnectionMonitor } from "@/hooks/use-connection-monitor";
import { useEventStream } from "@/hooks/use-event-stream";
import { useSettingsSync } from "@/hooks/use-settings-sync";
import { requestNotificationPermission } from "@/hooks/use-status-notifications";
import {
  PullToRefreshIndicator,
  PullToRefreshWrapper,
} from "@/components/pull-to-refresh-indicator";

function ConnectionStatusBanner() {
  const status = useConnectionMonitor();
  if (status === "connected") return null;
  const isUpstream = status === "upstream-down";
  return (
    <div className="flex flex-col gap-0.5 border-b border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <ArrowPathIcon className="size-4 shrink-0 animate-spin text-warning" />
        <span className="flex-1 text-fg">
          {isUpstream
            ? "Lost connection to the opencode server. Reconnecting\u2026"
            : "Lost connection to OpenPortal. Reconnecting\u2026"}
        </span>
        <Link
          to="/servers"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
        >
          <ServerStackIcon className="size-3.5" />
          Server list
        </Link>
      </div>
      <span className="pl-6 text-xs text-muted-fg">
        {isUpstream
          ? "Your prompt drafts and pasted images are saved locally. Reconnect via the Server list if needed."
          : "Your prompt drafts and pasted images are saved locally \u2014 nothing will be lost."}
      </span>
    </div>
  );
}

function BuildMismatchBanner() {
  const mismatched = useBuildMismatch();
  const [reloading, setReloading] = useState(false);
  if (!mismatched) return null;
  return (
    <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <ArrowPathIcon className="size-4 shrink-0 text-warning" />
      <span className="text-fg">
        OpenPortal was updated. Reload the page to get the latest version.
      </span>
      <button
        type="button"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          window.location.reload();
        }}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm font-medium hover:bg-muted disabled:opacity-70 inline-flex items-center gap-1.5"
      >
        <ArrowPathIcon
          className={`size-3.5 shrink-0 ${reloading ? "animate-spin" : ""}`}
        />
        {reloading ? "Reloading…" : "Reload"}
      </button>
    </div>
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
      <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        <BellAlertIcon className="size-4 shrink-0 text-warning" />
        <span className="flex-1 text-fg">
          Notifications are blocked at the browser level. Click the lock /
          tune icon in the address bar → Site settings → Notifications →
          Allow, then reload.
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
          aria-label="Dismiss"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-bg/95 px-3 py-2 text-sm">
      <BellAlertIcon className="size-4 shrink-0 text-muted-fg" />
      <span className="flex-1 text-fg">
        Get notified when sessions complete or need attention.
      </span>
      <button
        type="button"
        onClick={async () => {
          await requestNotificationPermission();
          setMode("hidden");
        }}
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium hover:bg-muted"
      >
        Enable
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
        aria-label="Dismiss"
      >
        <XMarkIcon className="size-4" />
      </button>
    </div>
  );
}

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const instance = useInstanceStore((s) => s.instance);
  const setInstance = useInstanceStore((s) => s.setInstance);
  const navigate = useNavigate();
  const { data: selfData, isLoading, error } = useSelfInstance();
  const [hydrated, setHydrated] = useState(false);
  usePullToRefresh();
  useSettingsSync();
  useEventStream();

  useEffect(() => {
    if (!selfData) return;
    if (selfData.instance) {
      const self = selfData.instance;
      if (
        !instance ||
        instance.port !== self.port ||
        instance.id !== self.id
      ) {
        setInstance({ id: self.id, name: self.name, port: self.port });
      }
    }
    setHydrated(true);
  }, [selfData, instance, setInstance]);

  // First-run / configless / no-active-server: bounce to /servers so the
  // user can pick or add one. Two failure modes that we deliberately do
  // NOT redirect on:
  //   1. Transient disconnect (opencode hiccup, mid-restart) - selfData
  //      flips to null for a poll cycle. seenInstanceRef catches this.
  //   2. SWR cache lag right after adoptServer's globalMutate - the
  //      window between adoptServer's navigate({to:"/"}) and the SWR
  //      cache committing the new selfData was bouncing the user
  //      straight back to /servers, leaving the green-Open click feeling
  //      silently broken. The persisted zustand instance store catches
  //      this: if the store already holds an instance, the active server
  //      is real, just not yet echoed back by selfData. The
  //      connection-monitor banner owns the disconnect UX.
  const seenInstanceRef = useRef(false);
  useEffect(() => {
    if (selfData?.instance || instance) seenInstanceRef.current = true;
    if (isLoading || !hydrated) return;
    if (!selfData?.instance && !instance && !seenInstanceRef.current) {
      void navigate({ to: "/servers", replace: true });
    }
  }, [isLoading, hydrated, selfData, instance, navigate]);

  if (isLoading || !hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-fg">
        Loading…
      </div>
    );
  }

  // No active instance: the effect above is about to navigate to
  // /servers. Show the same gentle "Loading…" copy instead of a louder
  // "Redirecting…" - the redirect is part of the normal first-run /
  // no-active-server flow, not an error state worth alarming the user
  // about.
  if (error || !selfData?.instance) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-fg">
        Loading…
      </div>
    );
  }

  if (!instance) return null;

  return (
    <BreadcrumbProvider>
      <PullToRefreshIndicator />
      <PullToRefreshWrapper>
        <SidebarProvider className="h-dvh overflow-hidden">
          <AppSidebar collapsible="dock" />
          <SidebarInset className="overflow-hidden">
            <ConnectionStatusBanner />
            <BuildMismatchBanner />
            <NotificationPermissionBanner />
            <PinnedTabStrip />
            <AppSidebarNav />
            <div className="flex-1 overflow-hidden">
              <Outlet />
            </div>
          </SidebarInset>
          <FileBrowserPanel />
        </SidebarProvider>
      </PullToRefreshWrapper>
    </BreadcrumbProvider>
  );
}
