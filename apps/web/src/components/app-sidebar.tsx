import { EllipsisHorizontalIcon } from "@heroicons/react/16/solid";
import {
  ChevronUpDownIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import {
  Cog6ToothIcon,
  TrashIcon,
  PlusIcon,
  FolderOpenIcon,
} from "@heroicons/react/24/solid";
import FileDiffIcon from "@/components/icons/file-diff-icon";
import { useEffect, useState, useMemo } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import { Avatar } from "@/components/ui/avatar";
import { Link as UILink } from "@/components/ui/link";
import { toast } from "@/components/ui/toast";
import IconBox from "@/components/icons/box-icon";
import {
  Menu,
  MenuContent,
  MenuHeader,
  MenuItem,
  MenuSection,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLabel,
  SidebarLink,
  SidebarMenuTrigger,
  SidebarRail,
  SidebarSection,
  SidebarSectionGroup,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  useSessions,
  useCreateSession,
  useDeleteSession,
  useCurrentProject,
  useHostname,
  useGitDiff,
} from "@/hooks/use-opencode";
import { useInstanceStore } from "@/stores/instance-store";
import { useNavigate, useMatch } from "@tanstack/react-router";
import type { Session } from "@opencode-ai/sdk";
import { FolderBrowserDialog } from "@/components/folder-browser";

interface Project {
  id: string;
  worktree: string;
  vcs?: string;
  time?: {
    created?: number;
    initialized?: number;
    updated?: number;
  };
}

function getProjectName(worktree: string): string {
  const parts = worktree.split("/");
  return parts[parts.length - 1] || worktree;
}

function CurrentProject() {
  const { data: currentProject } = useCurrentProject() as {
    data: Project | undefined;
  };

  const projectName = currentProject
    ? getProjectName(currentProject.worktree)
    : "Loading...";

  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <IconBox className="shrink-0" />
      <div className="text-sm font-medium">{projectName}</div>
    </div>
  );
}

function truncateTitle(title: string, maxLength = 40): string {
  if (title.length <= maxLength) return title;
  const halfLength = Math.floor((maxLength - 3) / 2);
  return `${title.slice(0, halfLength)}...${title.slice(-halfLength)}`;
}

function projectBasename(directory: string): string {
  const trimmed = directory.replace(/\/+$/g, "");
  const last = trimmed.split("/").pop();
  return last || directory;
}

interface ProjectGroupProps {
  directory: string;
  sessions: Session[];
  isExpanded: boolean;
  onToggle: () => void;
  currentSessionId: string | undefined;
  onSessionClick: () => void;
  onDeleteSession: (id: string) => void;
}

function ProjectGroup({
  directory,
  sessions,
  isExpanded,
  onToggle,
  currentSessionId,
  onSessionClick,
  onDeleteSession,
}: ProjectGroupProps) {
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    if (!isExpanded) setLimit(5);
  }, [isExpanded]);

  const visible = isExpanded ? sessions.slice(0, limit) : [];
  const remaining = sessions.length - visible.length;
  const projectName = projectBasename(directory);
  const containsCurrent = sessions.some((s) => s.id === currentSessionId);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        title={directory}
        className="flex items-center gap-1 w-full text-left px-2 py-1 rounded hover:bg-muted/30 transition-colors"
        data-current-project={containsCurrent || undefined}
      >
        <ChevronRightIcon
          className={`size-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
        />
        <span className="text-[12px] font-medium truncate flex-1">
          {projectName}
        </span>
        <span className="text-[11px] text-muted-fg shrink-0">
          {sessions.length}
        </span>
      </button>
      {visible.map((session) => (
        <SidebarItem key={session.id} tooltip={session.title}>
          {({ isCollapsed, isFocused }) => (
            <>
              <SidebarLink
                href={`/session/${session.id}`}
                onClick={onSessionClick}
              >
                <SidebarLabel className="text-xs sm:text-sm">
                  {truncateTitle(session.title)}
                </SidebarLabel>
              </SidebarLink>
              {(!isCollapsed || isFocused) && (
                <Menu>
                  <SidebarMenuTrigger aria-label="Session options">
                    <EllipsisHorizontalIcon />
                  </SidebarMenuTrigger>
                  <MenuContent
                    popover={{
                      offset: 0,
                      placement: "right top",
                    }}
                  >
                    <MenuItem
                      intent="danger"
                      onAction={() => onDeleteSession(session.id)}
                    >
                      <TrashIcon />
                      Delete Session
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </>
          )}
        </SidebarItem>
      ))}
      {isExpanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 10)}
          className="text-[11px] text-muted-fg hover:text-fg px-3 py-0.5 text-left"
        >
          Load {Math.min(10, remaining)} more
        </button>
      )}
    </>
  );
}

interface ProjectsListProps {
  sessions: Session[];
  currentSessionId: string | undefined;
  onSessionClick: () => void;
  onDeleteSession: (id: string) => void;
}

function ProjectsList({
  sessions,
  currentSessionId,
  onSessionClick,
  onDeleteSession,
}: ProjectsListProps) {
  const groups = useMemo(() => {
    const byDir = new Map<string, Session[]>();
    for (const s of sessions) {
      const d = s.directory || "(no directory)";
      const list = byDir.get(d) ?? [];
      list.push(s);
      byDir.set(d, list);
    }
    for (const list of byDir.values()) {
      list.sort(
        (a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0),
      );
    }
    const arr = Array.from(byDir.entries()).map(([dir, ss]) => ({
      dir,
      sessions: ss,
    }));
    arr.sort(
      (a, b) =>
        (b.sessions[0]?.time?.created ?? 0) -
        (a.sessions[0]?.time?.created ?? 0),
    );
    return arr;
  }, [sessions]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!currentSessionId) return;
    const cs = sessions.find((s) => s.id === currentSessionId);
    const dir = cs?.directory;
    if (!dir) return;
    setExpanded((prev) => {
      if (prev.has(dir)) return prev;
      return new Set([...prev, dir]);
    });
  }, [currentSessionId, sessions]);

  if (groups.length === 0) {
    return (
      <div className="text-xs text-muted-fg px-3 py-2">No sessions yet</div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <ProjectGroup
          key={group.dir}
          directory={group.dir}
          sessions={group.sessions}
          isExpanded={expanded.has(group.dir)}
          onToggle={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(group.dir)) next.delete(group.dir);
              else next.add(group.dir);
              return next;
            })
          }
          currentSessionId={currentSessionId}
          onSessionClick={onSessionClick}
          onDeleteSession={onDeleteSession}
        />
      ))}
    </>
  );
}

export default function AppSidebar(
  props: React.ComponentProps<typeof Sidebar>,
) {
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { setIsOpenOnMobile } = useSidebar();
  const instance = useInstanceStore((s) => s.instance);
  const { data: hostnameData } = useHostname();
  const hostname = hostnameData?.hostname ?? "Loading...";
  const { data: sessionsData, mutate: mutateSessions } = useSessions();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const sessions: Session[] = sessionsData ?? [];

  const { data: diffData } = useGitDiff();
  const diffFileCount = useMemo(() => {
    if (!diffData?.diff) return 0;
    try {
      const patches = parsePatchFiles(diffData.diff);
      return patches.reduce((count, patch) => count + patch.files.length, 0);
    } catch {
      return 0;
    }
  }, [diffData?.diff]);

  async function handleNewSession(directory?: string) {
    if (creating) return;
    setCreating(true);
    try {
      const session = await createSession(
        directory ? { directory } : undefined,
      );
      await mutateSessions();
      toast.success(
        directory ? `Session created in ${directory}` : "Session created",
      );
      navigate({ to: "/session/$id", params: { id: session.id } });
    } catch (error) {
      console.error("Failed to create session:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create session",
      );
    } finally {
      setCreating(false);
    }
  }

  const [browserOpen, setBrowserOpen] = useState(false);

  const currentSessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const currentSessionId = currentSessionMatch?.params?.id;

  async function handleDeleteSession(sessionId: string) {
    try {
      await deleteSession(sessionId);
      await mutateSessions();
      toast.success("Session deleted");
      // If we deleted the current session, navigate to home
      if (currentSessionId === sessionId) {
        navigate({ to: "/" });
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
      toast.error("Failed to delete session");
    }
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <UILink href="/" className="flex items-center gap-x-2">
          <img src="/logo.svg" alt="OpenCode Portal" className="size-6" />
          <SidebarLabel className="font-medium">
            OpenCode <span className="text-muted-fg">Portal</span>
          </SidebarLabel>
        </UILink>
      </SidebarHeader>
      <SidebarContent>
        <SidebarSectionGroup>
          <SidebarSection>
            <CurrentProject />
          </SidebarSection>

          <SidebarSection>
            <SidebarItem
              tooltip="New Session"
              onPress={() => handleNewSession()}
              className="cursor-pointer gap-x-2"
            >
              <PlusIcon className="size-4 shrink-0" data-slot="icon" />
              <SidebarLabel className="text-xs sm:text-sm">
                {creating ? "Creating..." : "New Session"}
              </SidebarLabel>
            </SidebarItem>
            <SidebarItem
              tooltip="Open directory"
              onPress={() => setBrowserOpen(true)}
              className="cursor-pointer gap-x-2"
            >
              <FolderOpenIcon className="size-4 shrink-0" data-slot="icon" />
              <SidebarLabel className="text-xs sm:text-sm">
                Open directory
              </SidebarLabel>
            </SidebarItem>
            <SidebarItem
              tooltip="View Git Diff"
              href="/diff"
              className="cursor-pointer gap-x-2"
              badge={diffFileCount > 0 ? diffFileCount : undefined}
            >
              <FileDiffIcon className="size-4 shrink-0" data-slot="icon" />
              <SidebarLabel className="text-xs sm:text-sm">Diff</SidebarLabel>
            </SidebarItem>
          </SidebarSection>

          <SidebarSection label="Projects">
            <ProjectsList
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSessionClick={() => setIsOpenOnMobile(false)}
              onDeleteSession={handleDeleteSession}
            />
          </SidebarSection>
        </SidebarSectionGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-row justify-between gap-4 group-data-[state=collapsed]:flex-col">
        <Menu>
          <MenuTrigger
            className="flex w-full items-center justify-between"
            aria-label="Profile"
          >
            <div className="flex items-center gap-x-2">
              <Avatar
                className="size-8 *:size-8 group-data-[state=collapsed]:size-6 group-data-[state=collapsed]:*:size-6"
                isSquare
                initials={hostname.slice(0, 2).toUpperCase()}
              />
              <div className="in-data-[collapsible=dock]:hidden text-sm">
                <SidebarLabel>{hostname}</SidebarLabel>
              </div>
            </div>
            <ChevronUpDownIcon data-slot="chevron" />
          </MenuTrigger>
          <MenuContent
            className="in-data-[sidebar-collapsible=collapsed]:min-w-56 min-w-(--trigger-width)"
            placement="bottom right"
          >
            <MenuSection>
              <MenuHeader separator>
                <span className="block">{hostname}</span>
                {instance && (
                  <span className="block text-muted-fg text-xs">
                    {instance.name}
                  </span>
                )}
              </MenuHeader>
            </MenuSection>

            <MenuItem
              onAction={() => {
                setIsOpenOnMobile(false);
                navigate({ to: "/settings" });
              }}
            >
              <Cog6ToothIcon />
              Settings
            </MenuItem>
          </MenuContent>
        </Menu>
      </SidebarFooter>
      <SidebarRail />
      <FolderBrowserDialog
        isOpen={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={(picked) => {
          setIsOpenOnMobile(false);
          handleNewSession(picked);
        }}
      />
    </Sidebar>
  );
}
