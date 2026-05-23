import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  BellAlertIcon,
  ExclamationTriangleIcon,
  ServerStackIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import AppSidebar from "@/components/app-sidebar";
import { AppSidebarNav, PinnedTabStrip } from "@/components/app-sidebar-nav";
import { FileBrowserPanel } from "@/components/file-browser-panel";
import { OpencodeUpdateBanner } from "@/components/opencode-update-banner";
import { StuckDetectorInstallBanner } from "@/components/stuck-detector-install-banner";
import { SystemMessagesDrawer } from "@/components/system-messages-drawer";
import { CompactBanner } from "@/components/ui/compact-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BreadcrumbProvider } from "@/contexts/breadcrumb-context";
import { useInstanceStore } from "@/stores/instance-store";
import { useBootstrapPrefetch, useSelfInstance } from "@/hooks/use-opencode";
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

// Global, always-visible-when-degraded health banner. Two modes:
//
//   - opencode-down: yellow / warning intent. Openportal-owned views
//     (prompts archive, server list, settings, persisted sessions
//     list) keep working off cached data. Live opencode reads
//     (session messages, providers, agents) auto-resume when
//     opencode is back. Distinct from a destructive banner because
//     the app is largely usable; we just want the user to know why
//     the chat view looks stuck.
//
//   - openportal-down: destructive intent. /api/instance/self itself
//     stopped answering, which means nothing else will load either.
//     The 'reconnecting' wording is honest because openportal-dev /
//     openportal restart hooks pick the server back up in seconds.
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
            archive, server list, settings) keep working. Live OpenCode
            reads resume automatically.
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
          Your prompt drafts and pasted images are saved locally - nothing
          will be lost.
        </span>
      }
    />
  );
}

interface RestartDetection {
  ok: boolean;
  reason?: string;
  message?: string;
  recommended?: { unitName: string; scope: "user" | "system"; activeState?: string } | null;
  candidates?: { unitName: string; scope: "user" | "system"; activeState?: string }[];
  source?: string;
}

function RestartOpencodeButton() {
  const [open, setOpen] = useState(false);
  const [detection, setDetection] = useState<RestartDetection | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const startDetect = async () => {
    setOpen(true);
    setResult(null);
    setDetection(null);
    try {
      const r = await fetch("/api/servers/restart-opencode", {
        method: "GET",
      });
      const data = (await r.json()) as RestartDetection;
      setDetection(data);
    } catch (err) {
      setDetection({
        ok: false,
        reason: "fetch-failed",
        message: err instanceof Error ? err.message : "detection failed",
      });
    }
  };

  const doRestart = async (unitName?: string) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/servers/restart-opencode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unitName ? { unitName } : {}),
      });
      const data = (await r.json()) as {
        ok: boolean;
        unitName?: string;
        output?: string;
        message?: string;
      };
      if (data.ok) {
        setResult(
          `Restarted ${data.unitName}. Reconnecting...`,
        );
        setTimeout(() => {
          setOpen(false);
          setResult(null);
        }, 2500);
      } else {
        setResult(
          data.message ??
            data.output ??
            "Restart failed - see OpenPortal logs for details.",
        );
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Restart request failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void startDetect()}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-fg hover:bg-muted"
        data-test="portal-restart-opencode"
        title="Detect and restart the OpenCode systemd unit"
      >
        <ArrowPathIcon className="size-3.5" />
        Restart
      </button>
    );
  }

  const recommended = detection?.recommended ?? null;
  const candidates = detection?.candidates ?? [];

  return (
    <div className="absolute top-12 right-3 z-50 w-[min(28rem,calc(100vw-1.5rem))] rounded-md border border-border bg-bg shadow-xl p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Restart OpenCode</span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="rounded p-0.5 text-muted-fg hover:bg-muted hover:text-fg"
          aria-label="Close"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      {detection === null && (
        <div className="flex items-center gap-2 text-muted-fg">
          <ArrowPathIcon className="size-3.5 animate-spin" />
          Detecting systemd unit...
        </div>
      )}
      {detection && !detection.ok && (
        <div className="text-danger-subtle-fg">
          {detection.message ?? "Detection failed."}
        </div>
      )}
      {detection?.ok && recommended && (
        <>
          <div className="text-fg">
            <span className="text-muted-fg">Recommended:</span>{" "}
            <code className="font-mono">{recommended.unitName}</code>{" "}
            <span className="text-muted-fg">
              ({recommended.scope}-scope
              {recommended.activeState
                ? `, ${recommended.activeState}`
                : ""}
              )
            </span>
          </div>
          <button
            type="button"
            onClick={() => void doRestart(recommended.unitName)}
            disabled={busy}
            data-test="portal-restart-opencode-confirm"
            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-fg hover:bg-warning/20 disabled:opacity-50"
          >
            <ArrowPathIcon
              className={`size-3.5 ${busy ? "animate-spin" : ""}`}
            />
            {busy ? "Restarting…" : `systemctl --user restart ${recommended.unitName}`}
          </button>
        </>
      )}
      {detection?.ok && !recommended && candidates.length > 0 && (
        <>
          <div className="text-muted-fg">
            Multiple opencode units found - pick one:
          </div>
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li key={c.unitName} className="flex items-center gap-2">
                <code className="flex-1 font-mono">{c.unitName}</code>
                <button
                  type="button"
                  onClick={() => void doRestart(c.unitName)}
                  disabled={busy}
                  className="rounded border border-border bg-bg px-2 py-0.5 hover:bg-muted disabled:opacity-50"
                >
                  Restart
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {detection?.ok && candidates.length === 0 && (
        <div className="text-muted-fg">
          No opencode-* systemd units found. OpenCode was likely started by
          hand or under a different scope - restart it the way you started it.
        </div>
      )}
      {result && (
        <div className="rounded border border-border bg-muted/40 px-2 py-1 text-xs whitespace-pre-wrap break-words">
          {result}
        </div>
      )}
    </div>
  );
}

function BuildMismatchBanner() {
  const mismatched = useBuildMismatch();
  const [reloading, setReloading] = useState(false);
  if (!mismatched) return null;
  return (
    <CompactBanner
      intent="warning"
      icon={<ArrowPathIcon className="size-3.5" aria-hidden />}
      message="OpenPortal updated - reload to upgrade"
      actions={
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
      <span className="flex-1 text-fg">
        Get notified on session events.
      </span>
      <button
        type="button"
        onClick={async () => {
          await requestNotificationPermission();
          setMode("hidden");
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
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        server: instance.id,
      }),
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
        instance.id !== self.id
      ) {
        setInstance({
          id: self.id,
          name: self.name,
          port: self.port,
          hostname: typeof self.hostname === "string" ? self.hostname : undefined,
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
            <AppSidebarNav />
            <BuildMismatchBanner />
            <NotificationPermissionBanner />
            <OpencodeUpdateBanner />
            <StuckDetectorInstallBanner />
            <ConnectionStatusBanner />
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
