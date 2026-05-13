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
  useInstances,
  usePortalConfig,
} from "@/hooks/use-opencode";
import { usePinnedSessions } from "@/hooks/use-pinned-sessions";
import { useInstanceStore } from "@/stores/instance-store";
import { resolveProjectPath } from "@/lib/project-path";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import { IconGridPlus } from "@/components/icons/grid-plus-icon";
import IconBox from "@/components/icons/box-icon";
import { IconThemeDark } from "@/components/icons/theme-dark-icon";
import { IconThemeLight } from "@/components/icons/theme-light-icon";
import { IconThemeSystem } from "@/components/icons/theme-system-icon";
import { IconManageInstances } from "@/components/icons/manage-instances-icon";
import {
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
  const { data: pinnedData } = usePinnedSessions();
  const createSession = useCreateSession();
  const { setTheme } = useTheme();
  const currentInstance = useInstanceStore((s) => s.instance);

  const sessions: Session[] = sessionsData ?? [];
  const instances: InstanceData[] = instancesData?.instances ?? [];
  const currentSessionId = params.id as string | undefined;

  // Split into a Pinned section (rendered first, in user-defined pin order
  // from drag-reorder in the topbar/sidebar) and a Recent section (the
  // rest, sorted by last-activity desc). When the search query is empty,
  // pinned sessions surface at the top - matching the user's mental
  // 'these are the ones I care about' grouping. When the user types,
  // react-aria's fuzzy filter narrows BOTH sections (pinned items get
  // hidden from Pinned if they don't match, same for Recent).
  // Combined cap of ~300 so the DOM stays manageable on huge histories;
  // pinned never gets capped because it's bounded by user behaviour
  // (you don't typically pin 100 sessions).
  const pinnedIds = useMemo(
    () => new Set(pinnedData?.sessions ?? []),
    [pinnedData?.sessions],
  );
  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);
  const pinnedSessions = useMemo(() => {
    const order = pinnedData?.sessions ?? [];
    const arr: Session[] = [];
    for (const id of order) {
      const s = sessionsById.get(id);
      if (s) arr.push(s);
    }
    return arr;
  }, [pinnedData?.sessions, sessionsById]);
  const recentSessions = useMemo(() => {
    const sorted = [...sessions]
      .filter((s) => !pinnedIds.has(s.id))
      .sort((a, b) => {
        const ta = (a.time as { updated?: number })?.updated ?? 0;
        const tb = (b.time as { updated?: number })?.updated ?? 0;
        return tb - ta;
      });
    return sorted.slice(0, 300);
  }, [sessions, pinnedIds]);

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

  const renderSessionItem = (session: Session, isPinned: boolean) => {
    const title = session.title || `Session ${session.id.slice(0, 8)}`;
    const projectLabel = projectLabelForSession(session);
    const textValue = projectLabel ? `${title} ${projectLabel}` : title;
    const isCurrent = session.id === currentSessionId;
    return (
      <CommandMenuItem
        key={session.id}
        textValue={textValue}
        onAction={() => handleSessionSelect(session.id)}
        isDisabled={isCurrent}
      >
        {isPinned ? (
          <StarSolidIcon className="size-4 text-amber-400" />
        ) : (
          <ChatBubbleLeftIcon className="size-4" />
        )}
        <CommandMenuLabel>
          <div className="flex items-center gap-2 min-w-0 w-full">
            <span className="flex-1 min-w-0 truncate">{title}</span>
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

  function handleSessionSelect(sessionId: string) {
    setIsOpen(false);
    navigate({
      to: "/session/$id",
      params: { id: sessionId },
      search: { focus: "composer" },
    });
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
        {pinnedSessions.length > 0 && (
          <CommandMenuSection label="Pinned">
            {pinnedSessions.map((session) =>
              renderSessionItem(session, true),
            )}
          </CommandMenuSection>
        )}

        {recentSessions.length > 0 && (
          <CommandMenuSection label={pinnedSessions.length > 0 ? "Recent" : "Sessions"}>
            {recentSessions.map((session) =>
              renderSessionItem(session, false),
            )}
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
          <CommandMenuItem
            textValue="Servers"
            onAction={() => {
              setIsOpen(false);
              navigate({ to: "/servers" });
            }}
          >
            <ServerIcon className="size-4 mr-2" />
            <CommandMenuLabel>Servers</CommandMenuLabel>
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
