import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "@tanstack/react-router";
import {
  CommandMenu,
  CommandMenuItem,
  CommandMenuLabel,
  CommandMenuList,
  CommandMenuSearch,
  CommandMenuSection,
} from "@/components/ui/command-menu";
import {
  useSessions,
  useCreateSession,
  useDeleteSession,
  useInstances,
  usePortalConfig,
} from "@/hooks/use-opencode";
import { useInstanceStore } from "@/stores/instance-store";
import { resolveProjectPath } from "@/lib/project-path";
import { IconGridPlus } from "@/components/icons/grid-plus-icon";
import IconBox from "@/components/icons/box-icon";
import { IconThemeDark } from "@/components/icons/theme-dark-icon";
import { IconThemeLight } from "@/components/icons/theme-light-icon";
import { IconThemeSystem } from "@/components/icons/theme-system-icon";
import { IconManageInstances } from "@/components/icons/manage-instances-icon";
import {
  TrashIcon,
  ChatBubbleLeftIcon,
  ServerIcon,
} from "@heroicons/react/24/solid";
import { useTheme } from "@/providers/theme-provider";
import { toast } from "@/components/ui/toast";
import type { Session } from "@opencode-ai/sdk";

function truncateTitle(title: string, maxLength = 40): string {
  if (title.length <= maxLength) return title;
  const halfLength = Math.floor((maxLength - 3) / 2);
  return `${title.slice(0, halfLength)}...${title.slice(-halfLength)}`;
}

interface InstanceData {
  id: string;
  name: string;
  directory: string;
  port: number;
  webPort: number | null;
  hostname: string;
  pid: number;
  startedAt: string;
  state: "running";
  status: string;
}

export default function Cmd() {
  const [isOpen, setIsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false });
  const { data: sessionsData, mutate } = useSessions();
  const { data: instancesData } = useInstances();
  const { data: portalConfig } = usePortalConfig();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const { setTheme } = useTheme();
  const currentInstance = useInstanceStore((s) => s.instance);

  const sessions: Session[] = sessionsData ?? [];
  const instances: InstanceData[] = instancesData?.instances ?? [];
  const currentSessionId = params.id as string | undefined;
  const isOnSessionPage =
    location.pathname.startsWith("/session/") && currentSessionId;

  // All sessions, sorted by last activity desc (the API already returns
  // them in this order; defensive re-sort in case the order ever changes).
  // Cap at 300 to keep DOM size sane on huge histories - users with more
  // than 300 sessions can still find any of them via the search filter
  // since react-aria's Autocomplete + useFilter does case-insensitive
  // contains-match against textValue across ALL rendered children.
  const allSessions = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      const ta = (a.time as { updated?: number })?.updated ?? 0;
      const tb = (b.time as { updated?: number })?.updated ?? 0;
      return tb - ta;
    });
    return sorted.slice(0, 300);
  }, [sessions]);

  const baseDirs = portalConfig?.baseDirs ?? [];
  const homeDir = portalConfig?.home ?? "";
  const projectLabelForSession = (session: Session): string => {
    const sessionDir = (session as { directory?: string }).directory;
    if (!sessionDir || baseDirs.length === 0) return "";
    const projectPath = resolveProjectPath(sessionDir, baseDirs);
    const display = homeDir && projectPath.startsWith(homeDir + "/")
      ? "~" + projectPath.slice(homeDir.length)
      : projectPath;
    const segments = display.split("/").filter(Boolean);
    return segments.length > 2
      ? segments.slice(-2).join("/")
      : display.replace(/^\//, "");
  };

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  async function handleNewSession() {
    setCreating(true);
    setIsOpen(false);
    try {
      const newSession = await createSession();
      await mutate();
      toast.success("Session created");
      navigate({ to: "/session/$id", params: { id: newSession.id } });
    } catch (err) {
      console.error("Failed to create session:", err);
      toast.error("Failed to create session");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteSession() {
    if (!currentSessionId) return;

    setIsOpen(false);
    try {
      await deleteSession(currentSessionId);
      await mutate();
      toast.success("Session deleted");
      navigate({ to: "/" });
    } catch (err) {
      console.error("Failed to delete session:", err);
      toast.error("Failed to delete session");
    }
  }

  function handleSessionSelect(sessionId: string) {
    setIsOpen(false);
    navigate({ to: "/session/$id", params: { id: sessionId } });
  }

  function handleThemeChange(theme: "light" | "dark" | "system") {
    setTheme(theme);
    setIsOpen(false);
  }

  function handleInstanceOpen(instance: InstanceData) {
    if (instance.id === currentInstance?.id) {
      setIsOpen(false);
      return;
    }
    if (!instance.webPort) {
      toast.error(`No web port registered for ${instance.name}`);
      return;
    }
    const host =
      instance.hostname === "0.0.0.0"
        ? window.location.hostname
        : instance.hostname;
    const url = `${window.location.protocol}//${host}:${instance.webPort}/`;
    window.open(url, "_blank", "noopener,noreferrer");
    setIsOpen(false);
  }

  return (
    <CommandMenu
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      shortcut="k"
      size="wide"
      isBlurred
    >
      <CommandMenuSearch placeholder="Jump to session, action, or theme..." />
      <CommandMenuList>
        {allSessions.length > 0 && (
          <CommandMenuSection label="Sessions">
            {allSessions.map((session) => {
              const title =
                session.title || `Session ${session.id.slice(0, 8)}`;
              const projectLabel = projectLabelForSession(session);
              const textValue = projectLabel
                ? `${title} ${projectLabel}`
                : title;
              const isCurrent = session.id === currentSessionId;
              return (
                <CommandMenuItem
                  key={session.id}
                  textValue={textValue}
                  onAction={() => handleSessionSelect(session.id)}
                  isDisabled={isCurrent}
                >
                  <ChatBubbleLeftIcon className="size-4" />
                  <CommandMenuLabel>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">
                        {truncateTitle(title)}
                      </span>
                      {projectLabel && (
                        <span className="text-xs text-muted-fg/70 shrink-0 font-mono">
                          {projectLabel}
                        </span>
                      )}
                      {isCurrent && (
                        <span className="text-[10px] uppercase tracking-wide text-primary shrink-0">
                          current
                        </span>
                      )}
                    </div>
                  </CommandMenuLabel>
                </CommandMenuItem>
              );
            })}
          </CommandMenuSection>
        )}

        {isOnSessionPage && (
          <CommandMenuSection label="Session Actions">
            <CommandMenuItem
              textValue="Delete current session"
              intent="danger"
              onAction={handleDeleteSession}
            >
              <TrashIcon className="size-4" />
              <CommandMenuLabel>Delete Current Session</CommandMenuLabel>
            </CommandMenuItem>
          </CommandMenuSection>
        )}

        <CommandMenuSection label="Actions">
          <CommandMenuItem
            textValue="New session"
            onAction={handleNewSession}
            isDisabled={creating}
          >
            <IconGridPlus className="size-4 mr-2" />
            <CommandMenuLabel>
              {creating ? "Creating..." : "New Session"}
            </CommandMenuLabel>
          </CommandMenuItem>
          <CommandMenuItem
            textValue="Other Portals"
            onAction={() => {
              setIsOpen(false);
              navigate({ to: "/instances" });
            }}
          >
            <IconManageInstances className="size-4 mr-2" />
            <CommandMenuLabel>Other Portals</CommandMenuLabel>
          </CommandMenuItem>
        </CommandMenuSection>

        {instances.length > 0 && (
          <CommandMenuSection label="Open in another Portal">
            {instances.map((instance) => (
              <CommandMenuItem
                key={instance.id}
                textValue={instance.name}
                onAction={() => handleInstanceOpen(instance)}
                isDisabled={currentInstance?.id === instance.id}
              >
                {currentInstance?.id === instance.id ? (
                  <IconBox className="size-4 mr-2" />
                ) : (
                  <ServerIcon className="size-4 mr-2" />
                )}
                <CommandMenuLabel>{instance.name}</CommandMenuLabel>
                {currentInstance?.id === instance.id && (
                  <div className="absolute right-2 size-2 rounded-full bg-primary" />
                )}
              </CommandMenuItem>
            ))}
          </CommandMenuSection>
        )}

        <CommandMenuSection label="Theme">
          <CommandMenuItem
            textValue="Light theme"
            onAction={() => handleThemeChange("light")}
          >
            <IconThemeLight className="size-4 mr-2" />
            <CommandMenuLabel>Light</CommandMenuLabel>
          </CommandMenuItem>
          <CommandMenuItem
            textValue="Dark theme"
            onAction={() => handleThemeChange("dark")}
          >
            <IconThemeDark className="size-4 mr-2" />
            <CommandMenuLabel>Dark</CommandMenuLabel>
          </CommandMenuItem>
          <CommandMenuItem
            textValue="System theme"
            onAction={() => handleThemeChange("system")}
          >
            <IconThemeSystem className="size-4 mr-2" />
            <CommandMenuLabel>System</CommandMenuLabel>
          </CommandMenuItem>
        </CommandMenuSection>
      </CommandMenuList>
    </CommandMenu>
  );
}
