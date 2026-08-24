import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import AppSidebar from "@/components/app-sidebar";
import { AppSidebarNav, PinnedTabStrip } from "@/components/app-sidebar-nav";
import { AppShellBanners } from "@/components/app-shell-banners";
import { FileBrowserPanel } from "@/components/file-browser-panel";
import { SystemMessagesDrawer } from "@/components/system-messages-drawer";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { useInstanceStore } from "@/stores/instance-store";
import { useBootstrapPrefetch, useSelfInstance } from "@/hooks/use-opencode";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useEventStream } from "@/hooks/use-event-stream";
import { useSettingsSync } from "@/hooks/use-settings-sync";
import { useStuckDetectorEvents } from "@/hooks/use-stuck-detector-events";
import { withServerSearch } from "@/lib/route-search";
import {
  PullToRefreshIndicator,
  PullToRefreshWrapper,
} from "@/components/pull-to-refresh-indicator";

interface AppSearch {
  server?: string;
}

export const Route = createFileRoute("/_app")({
  validateSearch: (raw: Record<string, unknown>): AppSearch => ({
    server:
      typeof raw.server === "string" && raw.server.length > 0
        ? raw.server
        : undefined,
  }),
  component: AppLayout,
});

function AppLayout() {
  const instance = useInstanceStore((s) => s.instance);
  const setInstance = useInstanceStore((s) => s.setInstance);
  const navigate = useNavigate();
  const { data: selfData, isLoading, error } = useSelfInstance();
  const [hydrated, setHydrated] = useState(false);
  const search = Route.useSearch();
  usePullToRefresh();
  useSettingsSync();
  useEventStream();
  useBootstrapPrefetch();
  useStuckDetectorEvents();

  // Permalink consumption: when a URL carries ?server=<id> and the
  // instance store is not yet bound to that server, POST to
  // /api/servers/active so the rest of the app talks to the intended
  // opencode. Fire-once per (id) - we never override a freshly-clicked
  // 'Use' action from /servers. Suppress when self-instance has not
  // hydrated yet so we don't race the initial bootstrap.
  const lastBoundFromUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const targetId = search.server;
    if (!targetId) return;
    if (!hydrated) return;
    if (instance?.id === targetId) return;
    if (lastBoundFromUrlRef.current === targetId) return;
    lastBoundFromUrlRef.current = targetId;
    void fetch("/api/servers/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: targetId }),
    }).catch(() => {
      // Permalink-driven activation is best-effort; if the server id is
      // unknown on this openportal, the existing redirect/banner path
      // handles the fallback.
    });
  }, [search.server, hydrated, instance?.id]);

  // Permalink emission: keep ?server=<id> in sync with the active
  // instance so every URL copies as a permalink. Skip until hydrated -
  // pre-hydration we'd stamp the wrong id (or null) ahead of the
  // consumer effect.
  useEffect(() => {
    if (!hydrated) return;
    if (!instance?.id) return;
    if (search.server === instance.id) return;
    void navigate({
      to: ".",
      search: (prev) => withServerSearch(prev, instance.id),
      replace: true,
    });
  }, [hydrated, instance?.id, search.server, navigate]);

  useEffect(() => {
    if (!selfData) return;
    if (selfData.instance) {
      const self = selfData.instance;
      if (
        !instance ||
        instance.port !== self.port ||
        instance.id !== self.id ||
        instance.name !== self.name ||
        instance.hostname !== self.hostname ||
        instance.protocol !== self.protocol ||
        instance.webEndpoint !== self.webEndpoint
      ) {
        setInstance({
          id: self.id,
          name: self.name,
          port: self.port,
          protocol: self.protocol,
          hostname:
            typeof self.hostname === "string" ? self.hostname : undefined,
          webEndpoint:
            typeof self.webEndpoint === "string" ? self.webEndpoint : undefined,
        });
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
  //
  // Important: when opencode is down but openportal is still up,
  // selfData.instance is null (since the probe failed) but the
  // persisted zustand instance store still holds the port we were
  // bound to. We MUST keep mounting the layout in that case so the
  // yellow ConnectionStatusBanner shows, prompts archive still loads,
  // session sidebar still lists cached sessions, etc. Only blank out
  // when BOTH the live response and the persisted store are empty -
  // i.e. genuine first-run / no-active-server.
  if (error && !instance) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-fg">
        Loading…
      </div>
    );
  }
  if (!selfData?.instance && !instance) {
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
            <PinnedTabStrip />
            <AppSidebarNav bannerSlot={<AppShellBanners />} />
            <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
              <Outlet />
            </div>
          </SidebarInset>
          <FileBrowserPanel />
        </SidebarProvider>
        <SystemMessagesDrawer />
      </PullToRefreshWrapper>
    </BreadcrumbProvider>
  );
}
