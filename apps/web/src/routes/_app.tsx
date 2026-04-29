import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BellAlertIcon, XMarkIcon } from "@heroicons/react/24/outline";
import AppSidebar from "@/components/app-sidebar";
import { AppSidebarNav } from "@/components/app-sidebar-nav";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { useInstanceStore } from "@/stores/instance-store";
import { useSelfInstance } from "@/hooks/use-opencode";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { requestNotificationPermission } from "@/hooks/use-status-notifications";
import {
  PullToRefreshIndicator,
  PullToRefreshWrapper,
} from "@/components/pull-to-refresh-indicator";

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
  const { data: selfData, isLoading, error } = useSelfInstance();
  const [hydrated, setHydrated] = useState(false);
  usePullToRefresh();

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

  if (isLoading || !hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-fg">
        Loading…
      </div>
    );
  }

  if (error || !selfData?.instance) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-medium">Portal not registered</h1>
          <p className="text-sm text-muted-fg">
            {selfData?.error ||
              (error instanceof Error ? error.message : "Unknown error")}
          </p>
          <p className="text-xs text-muted-fg">
            This Portal UI's web port is not in <code>~/.portal.json</code>.
            Restart it via the launcher.
          </p>
        </div>
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
            <NotificationPermissionBanner />
            <AppSidebarNav />
            <div className="flex-1 overflow-hidden">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </PullToRefreshWrapper>
    </BreadcrumbProvider>
  );
}
