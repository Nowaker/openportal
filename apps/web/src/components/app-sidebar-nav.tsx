import { useEffect, useMemo, useState } from "react";
import { useMatch } from "@tanstack/react-router";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
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

  const sessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const sessionId = sessionMatch?.params?.id;
  const sessions: Session[] = sessionsData ?? [];
  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title ?? null;
  const projectLabel = projectLabelFromDirectory(currentSession?.directory);

  // Browser tab title: '<project>: <session> - OpenPortal' on a session
  // route, plain 'OpenPortal' elsewhere. Restored on unmount so other
  // pages don't inherit a stale session label.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    if (sessionTitle) {
      const prefix = projectLabel ? `${projectLabel}: ` : "";
      document.title = `${prefix}${sessionTitle} - OpenPortal`;
    } else {
      document.title = "OpenPortal";
    }
    return () => {
      document.title = previous;
    };
  }, [sessionTitle, projectLabel]);

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
              {projectLabel && (
                <span className="text-muted-fg">{projectLabel}: </span>
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
        {enabledTools.length > 0 && (
          <Menu>
            <MenuTrigger aria-label="Run a tool">
              <Button
                intent="outline"
                size="sq-sm"
                isDisabled={!canRun || isBusy}
              >
                <EllipsisVerticalIcon className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent placement="bottom end" className="min-w-48">
              {enabledTools.map((tool) => (
                <MenuItem
                  key={tool.id}
                  onAction={() =>
                    runTool(tool.id, tool.prompt, tool.name)
                  }
                >
                  {tool.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}
      </span>
    </SidebarNav>
  );
}
