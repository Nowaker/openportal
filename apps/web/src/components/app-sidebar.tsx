import {
  ChevronUpDownIcon,
  ChevronRightIcon,
  ArchiveBoxIcon,
  ArchiveBoxArrowDownIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import {
  Cog6ToothIcon,
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
  useArchiveSession,
  useUnarchiveSession,
  useCurrentProject,
  useHostname,
  useGitDiff,
} from "@/hooks/use-opencode";
import { useInstanceStore } from "@/stores/instance-store";
import { useNavigate, useMatch } from "@tanstack/react-router";
import type { Session } from "@opencode-ai/sdk";
import { FolderBrowserDialog } from "@/components/folder-browser";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";

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
  archivedSessions: Session[];
  isExpanded: boolean;
  onToggle: () => void;
  onNewSessionInProject: () => void;
  currentSessionId: string | undefined;
  onSessionClick: () => void;
  onArchiveSession: (id: string) => void;
  onUnarchiveSession: (id: string) => void;
}

function ProjectGroup({
  directory,
  sessions,
  archivedSessions,
  isExpanded,
  onToggle,
  onNewSessionInProject,
  currentSessionId,
  onSessionClick,
  onArchiveSession,
  onUnarchiveSession,
}: ProjectGroupProps) {
  const [limit, setLimit] = useState(5);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedLimit, setArchivedLimit] = useState(5);
  useEffect(() => {
    if (!isExpanded) setLimit(5);
  }, [isExpanded]);
  useEffect(() => {
    if (!archivedExpanded) setArchivedLimit(5);
  }, [archivedExpanded]);

  const visible = isExpanded ? sessions.slice(0, limit) : [];
  const remaining = sessions.length - visible.length;
  const archivedVisible = archivedExpanded
    ? archivedSessions.slice(0, archivedLimit)
    : [];
  const archivedRemaining = archivedSessions.length - archivedVisible.length;
  const projectName = projectBasename(directory);
  const containsCurrent =
    sessions.some((s) => s.id === currentSessionId) ||
    archivedSessions.some((s) => s.id === currentSessionId);

  return (
    <>
      <div
        className="col-span-full flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/20 transition-colors"
        data-current-project={containsCurrent || undefined}
      >
        <button
          type="button"
          onClick={onToggle}
          title={directory}
          className="flex flex-1 items-center gap-1 min-w-0 text-left"
        >
          <ChevronRightIcon
            className={`size-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
          <span className="text-[12px] truncate">
            {projectName}
            {sessions.length > 0 && (
              <span className="ml-1 text-muted-fg">({sessions.length})</span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNewSessionInProject();
          }}
          title={`New session in ${directory}`}
          aria-label={`New session in ${projectName}`}
          className="shrink-0 inline-flex items-center justify-center size-5 rounded border border-border text-muted-fg hover:text-fg hover:border-fg/40 hover:bg-muted/40"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>
      {visible.map((session) => (
        <div
          key={session.id}
          className="col-span-full grid grid-cols-[1fr_auto] items-center pl-3 pr-1 hover:bg-muted/20 rounded"
        >
          <SidebarLink
            href={`/session/${session.id}`}
            onClick={onSessionClick}
            className="min-w-0"
          >
            <SidebarLabel className="text-xs sm:text-sm font-normal">
              {truncateTitle(session.title)}
            </SidebarLabel>
          </SidebarLink>
          <button
            type="button"
            onClick={() => onArchiveSession(session.id)}
            title="Archive session"
            aria-label={`Archive ${session.title}`}
            className="shrink-0 inline-flex items-center justify-center size-6 rounded text-muted-fg hover:text-fg hover:bg-muted/50"
          >
            <ArchiveBoxArrowDownIcon className="size-3.5" />
          </button>
        </div>
      ))}
      {isExpanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 10)}
          className="col-span-full text-[11px] text-muted-fg hover:text-fg pl-6 py-0.5 text-left"
        >
          Load {Math.min(10, remaining)} more
        </button>
      )}
      {isExpanded && archivedSessions.length > 0 && (
        <button
          type="button"
          onClick={() => setArchivedExpanded((v) => !v)}
          className="col-span-full flex items-center gap-1 pl-3 pr-2 py-0.5 text-[11px] text-muted-fg hover:text-fg text-left"
        >
          <ChevronRightIcon
            className={`size-3 shrink-0 transition-transform ${archivedExpanded ? "rotate-90" : ""}`}
          />
          <ArchiveBoxIcon className="size-3 shrink-0" />
          <span>Archived ({archivedSessions.length})</span>
        </button>
      )}
      {archivedVisible.map((session) => (
        <div
          key={session.id}
          className="col-span-full grid grid-cols-[1fr_auto] items-center pl-6 pr-1 hover:bg-muted/20 rounded text-muted-fg"
        >
          <SidebarLink
            href={`/session/${session.id}`}
            onClick={onSessionClick}
            className="min-w-0"
          >
            <SidebarLabel className="text-xs sm:text-sm font-normal italic">
              {truncateTitle(session.title)}
            </SidebarLabel>
          </SidebarLink>
          <button
            type="button"
            onClick={() => onUnarchiveSession(session.id)}
            title="Unarchive session"
            aria-label={`Unarchive ${session.title}`}
            className="shrink-0 inline-flex items-center justify-center size-6 rounded text-muted-fg hover:text-fg hover:bg-muted/50"
          >
            <ArrowUturnLeftIcon className="size-3.5" />
          </button>
        </div>
      ))}
      {archivedExpanded && archivedRemaining > 0 && (
        <button
          type="button"
          onClick={() => setArchivedLimit((l) => l + 10)}
          className="col-span-full text-[11px] text-muted-fg hover:text-fg pl-9 py-0.5 text-left"
        >
          Load {Math.min(10, archivedRemaining)} more
        </button>
      )}
    </>
  );
}

interface ProjectsListProps {
  sessions: Session[];
  currentSessionId: string | undefined;
  virtualDirectory: string | null;
  onSessionClick: () => void;
  onArchiveSession: (id: string) => void;
  onUnarchiveSession: (id: string) => void;
  onNewSessionInProject: (directory: string) => void;
}

interface ProjectBin {
  dir: string;
  sessions: Session[];
  archivedSessions: Session[];
}

function isArchived(s: Session): boolean {
  const t = (s.time as { archived?: number } | undefined)?.archived;
  return typeof t === "number" && t > 0;
}

function ProjectsList({
  sessions,
  currentSessionId,
  virtualDirectory,
  onSessionClick,
  onArchiveSession,
  onUnarchiveSession,
  onNewSessionInProject,
}: ProjectsListProps) {
  const groups = useMemo<ProjectBin[]>(() => {
    const byDir = new Map<string, ProjectBin>();
    for (const s of sessions) {
      if (s.parentID) continue;
      const d = s.directory || "(no directory)";
      let bin = byDir.get(d);
      if (!bin) {
        bin = { dir: d, sessions: [], archivedSessions: [] };
        byDir.set(d, bin);
      }
      if (isArchived(s)) bin.archivedSessions.push(s);
      else bin.sessions.push(s);
    }
    const sortByActivity = (a: Session, b: Session) =>
      (b.time?.updated ?? b.time?.created ?? 0) -
      (a.time?.updated ?? a.time?.created ?? 0);
    for (const bin of byDir.values()) {
      bin.sessions.sort(sortByActivity);
      bin.archivedSessions.sort(sortByActivity);
    }
    const arr = Array.from(byDir.values());
    arr.sort(
      (a, b) =>
        (b.sessions[0]?.time?.updated ??
          b.sessions[0]?.time?.created ??
          0) -
        (a.sessions[0]?.time?.updated ??
          a.sessions[0]?.time?.created ??
          0),
    );
    if (virtualDirectory) {
      const existingIdx = arr.findIndex((g) => g.dir === virtualDirectory);
      if (existingIdx > 0) {
        const [existing] = arr.splice(existingIdx, 1);
        arr.unshift(existing);
      } else if (existingIdx < 0) {
        arr.unshift({
          dir: virtualDirectory,
          sessions: [],
          archivedSessions: [],
        });
      }
    }
    return arr;
  }, [sessions, virtualDirectory]);

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

  useEffect(() => {
    if (!virtualDirectory) return;
    setExpanded((prev) => {
      if (prev.has(virtualDirectory)) return prev;
      return new Set([...prev, virtualDirectory]);
    });
  }, [virtualDirectory]);

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
          archivedSessions={group.archivedSessions}
          isExpanded={expanded.has(group.dir)}
          onToggle={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(group.dir)) next.delete(group.dir);
              else next.add(group.dir);
              return next;
            })
          }
          onNewSessionInProject={() => onNewSessionInProject(group.dir)}
          currentSessionId={currentSessionId}
          onSessionClick={onSessionClick}
          onArchiveSession={onArchiveSession}
          onUnarchiveSession={onUnarchiveSession}
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
  const virtualDirectory = useVirtualSessionStore((s) => s.directory);
  const setVirtualDirectory = useVirtualSessionStore((s) => s.setDirectory);
  const { data: hostnameData } = useHostname();
  const hostname = hostnameData?.hostname ?? "Loading...";
  const { data: sessionsData, mutate: mutateSessions } = useSessions();
  const createSession = useCreateSession();
  const archiveSession = useArchiveSession();
  const unarchiveSession = useUnarchiveSession();
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

  async function handleArchiveSession(sessionId: string) {
    try {
      await archiveSession(sessionId);
      await mutateSessions();
      toast.success("Session archived");
      if (currentSessionId === sessionId) {
        navigate({ to: "/" });
      }
    } catch (error) {
      console.error("Failed to archive session:", error);
      toast.error("Failed to archive session");
    }
  }

  async function handleUnarchiveSession(sessionId: string) {
    try {
      await unarchiveSession(sessionId);
      await mutateSessions();
      toast.success("Session unarchived");
    } catch (error) {
      console.error("Failed to unarchive session:", error);
      toast.error("Failed to unarchive session");
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
              virtualDirectory={virtualDirectory ?? null}
              onSessionClick={() => setIsOpenOnMobile(false)}
              onArchiveSession={handleArchiveSession}
              onUnarchiveSession={handleUnarchiveSession}
              onNewSessionInProject={(dir) => {
                setIsOpenOnMobile(false);
                setVirtualDirectory(dir);
                navigate({
                  to: "/session/new",
                  search: { directory: dir },
                });
              }}
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
          setVirtualDirectory(picked);
          navigate({
            to: "/session/new",
            search: { directory: picked },
          });
        }}
      />
    </Sidebar>
  );
}
