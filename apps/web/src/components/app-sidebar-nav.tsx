import { useEffect, useMemo, useState } from "react";
import { useMatch, useNavigate } from "@tanstack/react-router";
import {
  EllipsisVerticalIcon,
  InformationCircleIcon,
  StarIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { SessionInfoModal } from "@/components/session-info-modal";
import { SidebarNav, SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import { useInstanceStore } from "@/stores/instance-store";
import { useModelStore } from "@/stores/model-store";
import {
  useToolsStore,
  resolveToolsFromState,
} from "@/stores/tools-store";
import { mutateSessionMessages } from "@/hooks/use-session-messages";
import { useSessions } from "@/hooks/use-opencode";
import {
  usePinnedSessions,
  useTogglePinnedSession,
} from "@/hooks/use-pinned-sessions";
import { useSidebar } from "@/components/ui/sidebar";
import { useSidebarExpandStore } from "@/stores/sidebar-expand-store";
import type { Session } from "@opencode-ai/sdk";

// Take the deepest path component and use it as a short project label.
// session.directory can be absolute ('/home/u/projekty/nowaker/blah') or
// even a single-segment short name; either way the basename is what we
// surface in the topbar + browser tab.
function projectLabelFromDirectory(directory?: string): string | null {
  if (!directory) return null;
  const parts = directory.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

export function AppSidebarNav() {
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port ?? 0;
  const instanceId = instance?.id ?? null;
  const resolveModel = useModelStore((s) => s.resolveModel);
  const { setIsOpenOnMobile } = useSidebar();
  const expandKey = useSidebarExpandStore((s) => s.expand);
  const { data: sessionsData, mutate: mutateSessions } = useSessions();
  // Subscribe to the raw store slices and derive the resolved list via
  // useMemo. Calling s.enabledTools() inside the Zustand selector returns
  // a fresh array on every render and triggers React 18 error #185
  // (infinite update loop) because Zustand sees a new identity each time.
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const enabledTools = useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        systemOverrides,
        customTools,
      }).filter((tool) => tool.enabled),
    [disabledIds, systemOverrides, customTools],
  );

  const [runningToolId, setRunningToolId] = useState<string | null>(null);
  const [showSessionInfo, setShowSessionInfo] = useState(false);

  const sessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const sessionId = sessionMatch?.params?.id;
  const sessions: Session[] = sessionsData ?? [];
  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title ?? null;
  const projectLabel = projectLabelFromDirectory(currentSession?.directory);

  // Browser tab title: 'OP: <sessionTitle>' on a session route, plain
  // 'OpenPortal' elsewhere. Short 'OP:' prefix keeps the title legible in
  // narrow tab strips while still clearly signalling which app the tab is.
  // Restored on unmount so other pages don't inherit a stale session label.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = sessionTitle ? `OP: ${sessionTitle}` : "OpenPortal";
    return () => {
      document.title = previous;
    };
  }, [sessionTitle]);

  const runTool = async (toolId: string, prompt: string, label: string) => {
    if (!sessionId || !port) {
      toast.error("Please open a session first");
      return;
    }
    setRunningToolId(toolId);
    try {
      const selectedModel = resolveModel(sessionId, instanceId);
      const response = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: prompt, model: selectedModel }),
        },
      );
      if (!response.ok) throw new Error("Failed to send request");
      mutateSessionMessages(port, sessionId);
      mutateSessions();
      toast.success(`${label} request sent`);
    } catch (err) {
      console.error(`Failed to run ${label}:`, err);
      toast.error(`Failed to send ${label} request`);
    } finally {
      setRunningToolId(null);
    }
  };

  const isBusy = runningToolId !== null;
  const canRun = Boolean(sessionId);

  return (
    <SidebarNav isSticky>
      <span className="flex items-center gap-x-2 min-w-0 flex-1">
        <SidebarTrigger className="-ml-2 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
          {sessionTitle ? (
            <>
              {projectLabel && currentSession?.directory && (
                <button
                  type="button"
                  onClick={() => {
                    const dir = currentSession.directory;
                    if (!dir) return;
                    expandKey(dir);
                    setIsOpenOnMobile(true);
                    requestAnimationFrame(() => {
                      const el = document.querySelector(
                        `[data-project-dir="${CSS.escape(dir)}"]`,
                      );
                      el?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      });
                    });
                  }}
                  className="text-muted-fg hover:text-fg hover:underline underline-offset-2"
                  title={`Jump to ${projectLabel} in sidebar`}
                >
                  {projectLabel}
                </button>
              )}
              {projectLabel && currentSession?.directory && (
                <span className="text-muted-fg">: </span>
              )}
              {sessionTitle}
            </>
          ) : (
            <span className="text-muted-fg">
              {instance?.name ?? "OpenPortal"}
            </span>
          )}
        </span>
      </span>
      <span className="flex items-center gap-x-2 ml-auto shrink-0">
        {sessionId && <PinTopbarButton sessionId={sessionId} />}
        {(sessionId || enabledTools.length > 0) && (
          <Menu>
            <MenuTrigger aria-label="Open menu">
              <Button intent="outline" size="sq-sm">
                <EllipsisVerticalIcon className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent placement="bottom end" className="min-w-56">
              {sessionId && (
                <MenuSection label="Native">
                  <MenuItem onAction={() => setShowSessionInfo(true)}>
                    <InformationCircleIcon
                      className="size-4"
                      data-slot="icon"
                    />
                    Session info
                  </MenuItem>
                </MenuSection>
              )}
              {sessionId && enabledTools.length > 0 && <MenuSeparator />}
              {enabledTools.length > 0 && (
                <MenuSection label="Prompt templates">
                  {enabledTools.map((tool) => (
                    <MenuItem
                      key={tool.id}
                      isDisabled={!canRun || isBusy}
                      onAction={() => runTool(tool.id, tool.prompt, tool.name)}
                    >
                      {tool.name}
                    </MenuItem>
                  ))}
                </MenuSection>
              )}
            </MenuContent>
          </Menu>
        )}
      </span>
      {sessionId && (
        <SessionInfoModal
          isOpen={showSessionInfo}
          sessionId={sessionId}
          onOpenChange={setShowSessionInfo}
        />
      )}
    </SidebarNav>
  );
}

function PinTopbarButton({ sessionId }: { sessionId: string }) {
  const { data } = usePinnedSessions();
  const togglePin = useTogglePinnedSession();
  const isPinned = data?.sessions.includes(sessionId) ?? false;
  return (
    <button
      type="button"
      aria-label={isPinned ? "Unpin session" : "Pin session"}
      title={isPinned ? "Unpin session" : "Pin session"}
      onClick={() => {
        void togglePin(sessionId, isPinned ? "unpin" : "pin");
      }}
      className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
    >
      {isPinned ? (
        <StarSolidIcon className="size-4 text-amber-400" />
      ) : (
        <StarIcon className="size-4" />
      )}
    </button>
  );
}

// Horizontal tab strip showing one tab per pinned session. Tab styling:
// no rounded boxes - flat strip with a bottom-border on the active tab
// only, like browser tabs / a tabbed nav. Tabs whose session id isn't in
// the live sessions list are silently skipped so transient opencode
// disconnects don't lose pins. The active session highlights; click
// navigates; the X button calls unpin without affecting the session
// itself (don't conflate "remove from quick-access" with "delete").
//
// Mounted at the very top of the SidebarInset (below only the global
// banners) so it acts as the app's primary navigation chrome on both
// desktop AND mobile.
export function PinnedTabStrip() {
  const { data } = usePinnedSessions();
  const { data: sessionsData } = useSessions();
  const togglePin = useTogglePinnedSession();
  const navigate = useNavigate();
  const sessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const currentSessionId = sessionMatch?.params?.id ?? null;

  const pinned = data?.sessions ?? [];
  const sessions: Session[] = sessionsData ?? [];
  const tabs = pinned
    .map((id) => ({ id, session: sessions.find((s) => s.id === id) ?? null }))
    .filter((t): t is { id: string; session: Session } => t.session !== null);

  if (tabs.length === 0) return null;

  return (
    <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg/95">
      {tabs.map(({ id, session }) => {
        const active = id === currentSessionId;
        const title = session.title ?? "(untitled)";
        return (
          <div
            key={id}
            className={`group relative flex items-center gap-1 -mb-px border-b-2 px-3 py-1.5 text-xs transition-colors shrink-0 ${
              active
                ? "border-primary bg-bg text-fg"
                : "border-transparent text-muted-fg hover:bg-muted/30 hover:text-fg"
            }`}
          >
            <button
              type="button"
              onClick={() =>
                void navigate({ to: "/session/$id", params: { id } })
              }
              className="max-w-[16rem] truncate text-left"
              title={title}
            >
              {title}
            </button>
            <button
              type="button"
              onClick={() => void togglePin(id, "unpin")}
              aria-label={`Unpin ${title}`}
              title="Unpin"
              className="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted/40"
            >
              <XMarkIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
