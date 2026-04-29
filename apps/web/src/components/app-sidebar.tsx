import {
  ChevronUpDownIcon,
  ChevronRightIcon,
  ArchiveBoxIcon,
  ArchiveBoxArrowDownIcon,
  ArrowUturnLeftIcon,
  BellAlertIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import {
  Cog6ToothIcon,
  PlusIcon,
  FolderOpenIcon,
} from "@heroicons/react/24/solid";
import { useEffect, useState, useMemo } from "react";
import useMediaQuery from "@/hooks/use-media-query";
import { Avatar } from "@/components/ui/avatar";
import { Link as UILink } from "@/components/ui/link";
import { toast } from "@/components/ui/toast";

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
  useHostname,
  useSessionStatus,
  useQuestions,
  usePortalConfig,
  useProjectPaths,
  type SessionStatusMap,
} from "@/hooks/use-opencode";
import { useSessionErrorStore } from "@/stores/session-error-store";
import {
  resolveProjectPath,
  buildProjectTree,
  type BaseDirEntry,
  type ProjectTreeNode,
} from "@/lib/project-path";

const DRAFT_KEY_PREFIX = "opencode-composer-draft:";
const LAST_VIEWED_KEY_PREFIX = "opencode-last-viewed:";

function sessionHasDraft(sessionId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(DRAFT_KEY_PREFIX + sessionId);
    return Boolean(v && v.length > 0);
  } catch {
    return false;
  }
}

function getLastViewed(sessionId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(
      LAST_VIEWED_KEY_PREFIX + sessionId,
    );
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function sessionHasNewContent(session: Session, currentSessionId?: string): boolean {
  if (session.id === currentSessionId) return false;
  const updated = session.time?.updated ?? 0;
  if (!updated) return false;
  return updated > getLastViewed(session.id);
}
import { useInstanceStore } from "@/stores/instance-store";
import { useNavigate, useMatch } from "@tanstack/react-router";
import type { Session } from "@opencode-ai/sdk";
import { FolderBrowserDialog } from "@/components/folder-browser";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";
import { useSidebarExpandStore } from "@/stores/sidebar-expand-store";
import {
  useStatusNotifications,
  requestNotificationPermission,
} from "@/hooks/use-status-notifications";

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

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-300/40 text-fg rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
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
  statusMap: SessionStatusMap | undefined;
  searchQuery: string;
  questionSessionIds: Set<string>;
  errorSessionIds: Set<string>;
  displayName?: string;
  depth?: number;
}

function SessionStatusDot({
  status,
  hasNewContent,
  hasQuestion,
  hasError,
}: {
  status: "busy" | "retry" | "idle" | undefined;
  hasNewContent: boolean;
  hasQuestion?: boolean;
  hasError?: boolean;
}) {
  if (hasQuestion || hasError) {
    const label = hasQuestion ? "AI is waiting on your answer" : "Session has error";
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-red-500"
        aria-label={label}
        title={label}
      />
    );
  }
  if (status === "busy") {
    return (
      <span
        className="relative flex size-2 shrink-0"
        aria-label="Session is running"
        title="Session is running"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
      </span>
    );
  }
  if (status === "retry") {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-amber-600"
        aria-label="Session is retrying"
        title="Session is retrying"
      />
    );
  }
  if (hasNewContent) {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-emerald-500"
        aria-label="Task complete - review needed"
        title="Task complete - review needed"
      />
    );
  }
  return null;
}

function DraftIndicator({ hasDraft }: { hasDraft: boolean }) {
  if (!hasDraft) return null;
  return (
    <PencilSquareIcon
      className="size-3 shrink-0 text-sky-500"
      aria-label="Unsent draft"
      title="Unsent draft"
    />
  );
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
  statusMap,
  searchQuery,
  questionSessionIds,
  errorSessionIds,
  displayName,
  depth = 0,
}: ProjectGroupProps) {
  const { isMobile } = useMediaQuery();
  const sessionStep = isMobile ? 5 : 10;
  const [limit, setLimit] = useState(sessionStep);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedLimit, setArchivedLimit] = useState(sessionStep);
  useEffect(() => {
    if (!isExpanded) setLimit(sessionStep);
  }, [isExpanded, sessionStep]);
  useEffect(() => {
    if (!archivedExpanded) setArchivedLimit(sessionStep);
  }, [archivedExpanded, sessionStep]);

  // If the user is viewing a session that lives below the per-project
  // visible window, hoist it to the top of the visible slice so they can
  // always see (and click back to) the session they're currently in.
  // Falls back to natural ordering automatically when currentSessionId
  // changes, so navigating away "unpins" the session.
  const visibleAndCount = useMemo(() => {
    if (!isExpanded) return { rows: [] as typeof sessions, count: 0 };
    const head = sessions.slice(0, limit);
    if (
      currentSessionId &&
      !head.some((s) => s.id === currentSessionId) &&
      sessions.some((s) => s.id === currentSessionId)
    ) {
      const pinned = sessions.find((s) => s.id === currentSessionId)!;
      const rest = sessions
        .filter((s) => s.id !== currentSessionId)
        .slice(0, Math.max(0, limit - 1));
      return { rows: [pinned, ...rest], count: limit };
    }
    return { rows: head, count: head.length };
  }, [isExpanded, sessions, limit, currentSessionId]);
  const visible = visibleAndCount.rows;
  const remaining = sessions.length - visibleAndCount.count;
  const archivedVisible = archivedExpanded
    ? archivedSessions.slice(0, archivedLimit)
    : [];
  const archivedRemaining = archivedSessions.length - archivedVisible.length;
  const projectName = displayName ?? projectBasename(directory);
  const containsCurrent =
    sessions.some((s) => s.id === currentSessionId) ||
    archivedSessions.some((s) => s.id === currentSessionId);
  const headerStyle = depth > 0 ? { paddingLeft: `${0.5 + depth * 0.75}rem` } : undefined;
  const sessionRowStyle = depth > 0 ? { paddingLeft: `${0.75 + depth * 0.75}rem` } : undefined;

  return (
    <>
      <div
        className={`col-span-full flex items-center gap-1 ${depth > 0 ? "pr-2" : "px-2"} py-1 rounded hover:bg-muted/20 transition-colors`}
        style={headerStyle}
        data-current-project={containsCurrent || undefined}
        data-project-dir={directory}
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
            {highlightMatch(projectName, searchQuery)}
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
      {visible.map((session) => {
        const status = statusMap?.[session.id]?.type;
        const hasDraft = sessionHasDraft(session.id);
        const hasNewContent = sessionHasNewContent(session, currentSessionId);
        const hasQuestion = questionSessionIds.has(session.id);
        const hasError = errorSessionIds.has(session.id);
        const isCurrent = session.id === currentSessionId;
        return (
          <div
            key={session.id}
            className={`col-span-full flex items-center gap-1.5 ${depth > 0 ? "pr-1" : "pl-3 pr-1"} rounded ${isCurrent ? "bg-primary/15" : "hover:bg-muted/20"}`}
            style={depth > 0 ? sessionRowStyle : undefined}
            data-current-session={isCurrent || undefined}
          >
            <SessionStatusDot
              status={status}
              hasNewContent={hasNewContent}
              hasQuestion={hasQuestion}
              hasError={hasError}
            />
            <DraftIndicator hasDraft={hasDraft} />
            <UILink
              href={`/session/${session.id}`}
              onClick={onSessionClick}
              className="flex-1 min-w-0 py-1 text-xs sm:text-sm font-normal text-sidebar-fg hover:text-fg truncate block"
            >
              {highlightMatch(truncateTitle(session.title), searchQuery)}
            </UILink>
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
        );
      })}
      {isExpanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + sessionStep)}
          className="col-span-full text-[11px] text-muted-fg hover:text-fg pl-6 py-0.5 text-left"
        >
          Show {Math.min(sessionStep, remaining)} more
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
          className="col-span-full flex items-center gap-1 pl-6 pr-1 hover:bg-muted/20 rounded text-muted-fg"
        >
          <UILink
            href={`/session/${session.id}`}
            onClick={onSessionClick}
            className="flex-1 min-w-0 py-1 text-xs sm:text-sm font-normal italic text-muted-fg hover:text-fg truncate block"
          >
            {highlightMatch(truncateTitle(session.title), searchQuery)}
          </UILink>
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
          onClick={() => setArchivedLimit((l) => l + sessionStep)}
          className="col-span-full text-[11px] text-muted-fg hover:text-fg pl-9 py-0.5 text-left"
        >
          Show {Math.min(sessionStep, archivedRemaining)} more
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
  statusMap: SessionStatusMap | undefined;
  searchQuery: string;
  baseDirs: BaseDirEntry[];
  emptyProjectPaths: string[];
  questionSessionIds: Set<string>;
  errorSessionIds: Set<string>;
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
  statusMap,
  searchQuery,
  baseDirs,
  emptyProjectPaths,
  questionSessionIds,
  errorSessionIds,
}: ProjectsListProps) {
  const groups = useMemo<ProjectBin[]>(() => {
    const byDir = new Map<string, ProjectBin>();

    for (const path of emptyProjectPaths) {
      if (!byDir.has(path)) {
        byDir.set(path, { dir: path, sessions: [], archivedSessions: [] });
      }
    }

    for (const s of sessions) {
      if (s.parentID) continue;
      const sourceDir = s.directory || "";
      const projectPath =
        baseDirs.length > 0 && sourceDir
          ? resolveProjectPath(sourceDir, baseDirs)
          : sourceDir || "(no directory)";
      let bin = byDir.get(projectPath);
      if (!bin) {
        bin = { dir: projectPath, sessions: [], archivedSessions: [] };
        byDir.set(projectPath, bin);
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
    arr.sort((a, b) => {
      const aHas = a.sessions.length > 0;
      const bHas = b.sessions.length > 0;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas) {
        return (
          (b.sessions[0]?.time?.updated ?? b.sessions[0]?.time?.created ?? 0) -
          (a.sessions[0]?.time?.updated ?? a.sessions[0]?.time?.created ?? 0)
        );
      }
      return a.dir.localeCompare(b.dir);
    });
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
  }, [sessions, virtualDirectory, baseDirs, emptyProjectPaths]);

  const filteredGroups = useMemo<ProjectBin[]>(() => {
    if (!searchQuery) return groups;
    const q = searchQuery.toLowerCase();
    const out: ProjectBin[] = [];
    for (const g of groups) {
      const projectMatches = projectBasename(g.dir)
        .toLowerCase()
        .includes(q);
      const matchedSessions = g.sessions.filter((s) =>
        (s.title ?? "").toLowerCase().includes(q),
      );
      const matchedArchived = g.archivedSessions.filter((s) =>
        (s.title ?? "").toLowerCase().includes(q),
      );
      if (projectMatches) {
        out.push(g);
      } else if (matchedSessions.length || matchedArchived.length) {
        out.push({
          dir: g.dir,
          sessions: matchedSessions,
          archivedSessions: matchedArchived,
        });
      }
    }
    return out;
  }, [groups, searchQuery]);

  const expanded = useSidebarExpandStore((s) => s.expanded);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const toggleExpand = useSidebarExpandStore((s) => s.toggle);
  const expandKey = useSidebarExpandStore((s) => s.expand);

  const tempExpanded = useMemo(() => {
    if (!searchQuery) return new Set<string>();
    return new Set(filteredGroups.map((g) => g.dir));
  }, [filteredGroups, searchQuery]);

  useEffect(() => {
    if (!currentSessionId) return;
    const cs = sessions.find((s) => s.id === currentSessionId);
    const dir = cs?.directory;
    if (!dir) return;
    expandKey(dir);
  }, [currentSessionId, sessions, expandKey]);

  useEffect(() => {
    if (!virtualDirectory) return;
    expandKey(virtualDirectory);
  }, [virtualDirectory, expandKey]);

  const binMap = useMemo(() => {
    const m = new Map<string, ProjectBin>();
    for (const g of filteredGroups) m.set(g.dir, g);
    return m;
  }, [filteredGroups]);

  const trees = useMemo(() => {
    if (baseDirs.length === 0) return [];
    return buildProjectTree<ProjectBin>(
      baseDirs,
      binMap,
      (bin) =>
        bin.sessions[0]?.time?.updated ?? bin.sessions[0]?.time?.created ?? 0,
    );
  }, [baseDirs, binMap]);

  // Skip the base-dir root container; render its children at top level. If the
  // base itself is a project (rare: session.directory === base.path), surface
  // it as a sibling leaf so it isn't lost.
  const topLevelNodes = useMemo<ProjectTreeNode<ProjectBin>[]>(() => {
    if (baseDirs.length === 0) {
      return filteredGroups.map((g) => ({
        name: projectBasename(g.dir),
        path: g.dir,
        isProject: true,
        bin: g,
        children: [],
      }));
    }
    const out: ProjectTreeNode<ProjectBin>[] = [];
    for (const root of trees) {
      if (root.children.length > 0) {
        out.push(...root.children);
        if (root.isProject && root.bin) {
          out.push({ ...root, children: [] });
        }
      } else if (root.isProject) {
        out.push(root);
      }
    }
    return out;
  }, [trees, baseDirs, filteredGroups]);

  if (groups.length === 0) {
    return (
      <div className="text-xs text-muted-fg px-3 py-2">No sessions yet</div>
    );
  }

  if (searchQuery && filteredGroups.length === 0) {
    return (
      <div className="text-xs text-muted-fg px-3 py-2">
        No matches for "{searchQuery}"
      </div>
    );
  }

  return (
    <TreeChildren
      nodes={topLevelNodes}
      depth={0}
      expandedSet={expandedSet}
      tempExpanded={tempExpanded}
      toggleExpand={toggleExpand}
      currentSessionId={currentSessionId}
      onSessionClick={onSessionClick}
      onArchiveSession={onArchiveSession}
      onUnarchiveSession={onUnarchiveSession}
      onNewSessionInProject={onNewSessionInProject}
      statusMap={statusMap}
      searchQuery={searchQuery}
      questionSessionIds={questionSessionIds}
      errorSessionIds={errorSessionIds}
    />
  );
}

interface AggregateStatus {
  status: "busy" | "retry" | undefined;
  newContent: boolean;
  draft: boolean;
  question: boolean;
  error: boolean;
  sessionCount: number;
}

function aggregateNodeStatus(
  node: ProjectTreeNode<ProjectBin>,
  statusMap: SessionStatusMap | undefined,
  currentSessionId: string | undefined,
  questionSessionIds: Set<string>,
  errorSessionIds: Set<string>,
): AggregateStatus {
  const acc: AggregateStatus = {
    status: undefined,
    newContent: false,
    draft: false,
    question: false,
    error: false,
    sessionCount: 0,
  };
  const visit = (n: ProjectTreeNode<ProjectBin>) => {
    if (n.bin) {
      acc.sessionCount += n.bin.sessions.length;
      for (const s of n.bin.sessions) {
        const t = statusMap?.[s.id]?.type;
        if (t === "busy") acc.status = "busy";
        else if (t === "retry" && acc.status !== "busy") acc.status = "retry";
        if (sessionHasNewContent(s, currentSessionId)) acc.newContent = true;
        if (sessionHasDraft(s.id)) acc.draft = true;
        if (questionSessionIds.has(s.id)) acc.question = true;
        if (errorSessionIds.has(s.id)) acc.error = true;
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(node);
  return acc;
}

function nodeHasAnySessions(node: ProjectTreeNode<ProjectBin>): boolean {
  if (node.bin && node.bin.sessions.length > 0) return true;
  for (const c of node.children) {
    if (nodeHasAnySessions(c)) return true;
  }
  return false;
}

interface TreeChildrenProps {
  nodes: ProjectTreeNode<ProjectBin>[];
  depth: number;
  expandedSet: Set<string>;
  tempExpanded: Set<string>;
  toggleExpand: (key: string) => void;
  currentSessionId: string | undefined;
  onSessionClick: () => void;
  onArchiveSession: (id: string) => void;
  onUnarchiveSession: (id: string) => void;
  onNewSessionInProject: (dir: string) => void;
  statusMap: SessionStatusMap | undefined;
  searchQuery: string;
  questionSessionIds: Set<string>;
  errorSessionIds: Set<string>;
}

// Splits a node's children into "has-sessions" (rendered always) vs "empty"
// (no descendant has any active session, hidden behind a per-level "Show N
// more" reveal). Each TreeChildren instance owns its own emptyLimit state,
// so each branch in the tree paginates its own empty-folder list.
function TreeChildren({ nodes, ...rest }: TreeChildrenProps) {
  const { isMobile } = useMediaQuery();
  const emptyStep = isMobile ? 10 : 20;
  const [emptyLimit, setEmptyLimit] = useState(0);

  const { withSessions, empty } = useMemo(() => {
    const ws: ProjectTreeNode<ProjectBin>[] = [];
    const em: ProjectTreeNode<ProjectBin>[] = [];
    for (const n of nodes) {
      if (nodeHasAnySessions(n)) ws.push(n);
      else em.push(n);
    }
    return { withSessions: ws, empty: em };
  }, [nodes]);

  const visibleEmpty = empty.slice(0, emptyLimit);
  const remainingEmpty = empty.length - visibleEmpty.length;

  return (
    <>
      {withSessions.map((node) => (
        <TreeNodeRow key={node.path} node={node} {...rest} />
      ))}
      {visibleEmpty.map((node) => (
        <TreeNodeRow key={node.path} node={node} {...rest} />
      ))}
      {remainingEmpty > 0 && (
        <button
          type="button"
          onClick={() => setEmptyLimit((l) => l + emptyStep)}
          className="col-span-full text-[11px] text-muted-fg hover:text-fg py-0.5 text-left"
          style={{ paddingLeft: `${0.5 + rest.depth * 0.75}rem` }}
        >
          Show {Math.min(emptyStep, remainingEmpty)} more
          {emptyLimit === 0 ? " empty" : ""}
        </button>
      )}
    </>
  );
}

interface TreeNodeRowProps {
  node: ProjectTreeNode<ProjectBin>;
  depth: number;
  expandedSet: Set<string>;
  tempExpanded: Set<string>;
  toggleExpand: (key: string) => void;
  currentSessionId: string | undefined;
  onSessionClick: () => void;
  onArchiveSession: (id: string) => void;
  onUnarchiveSession: (id: string) => void;
  onNewSessionInProject: (dir: string) => void;
  statusMap: SessionStatusMap | undefined;
  searchQuery: string;
  questionSessionIds: Set<string>;
  errorSessionIds: Set<string>;
}

function TreeNodeRow({
  node,
  depth,
  expandedSet,
  tempExpanded,
  toggleExpand,
  currentSessionId,
  onSessionClick,
  onArchiveSession,
  onUnarchiveSession,
  onNewSessionInProject,
  statusMap,
  searchQuery,
  questionSessionIds,
  errorSessionIds,
}: TreeNodeRowProps) {
  const isExpanded =
    expandedSet.has(node.path) || tempExpanded.has(node.path);

  if (node.children.length === 0 && node.bin) {
    return (
      <ProjectGroup
        directory={node.bin.dir}
        displayName={node.name}
        depth={depth}
        sessions={node.bin.sessions}
        archivedSessions={node.bin.archivedSessions}
        isExpanded={isExpanded}
        onToggle={() => toggleExpand(node.path)}
        onNewSessionInProject={() => onNewSessionInProject(node.bin!.dir)}
        currentSessionId={currentSessionId}
        onSessionClick={onSessionClick}
        onArchiveSession={onArchiveSession}
        onUnarchiveSession={onUnarchiveSession}
        statusMap={statusMap}
        searchQuery={searchQuery}
        questionSessionIds={questionSessionIds}
        errorSessionIds={errorSessionIds}
      />
    );
  }

  const aggregate = aggregateNodeStatus(
    node,
    statusMap,
    currentSessionId,
    questionSessionIds,
    errorSessionIds,
  );

  return (
    <>
      <div
        className="col-span-full flex items-center gap-1 pr-2 py-1 rounded hover:bg-muted/20 transition-colors"
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        <button
          type="button"
          onClick={() => toggleExpand(node.path)}
          title={node.path}
          className="flex flex-1 items-center gap-1 min-w-0 text-left"
        >
          <ChevronRightIcon
            className={`size-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
          <SessionStatusDot
            status={aggregate.status}
            hasNewContent={aggregate.newContent}
            hasQuestion={aggregate.question}
            hasError={aggregate.error}
          />
          <DraftIndicator hasDraft={aggregate.draft} />
          <span className="text-[12px] truncate">
            {highlightMatch(node.name, searchQuery)}
            {aggregate.sessionCount > 0 && (
              <span className="ml-1 text-muted-fg">
                ({aggregate.sessionCount})
              </span>
            )}
          </span>
        </button>
      </div>
      {isExpanded && (
        <TreeChildren
          nodes={node.children}
          depth={depth + 1}
          expandedSet={expandedSet}
          tempExpanded={tempExpanded}
          toggleExpand={toggleExpand}
          currentSessionId={currentSessionId}
          onSessionClick={onSessionClick}
          onArchiveSession={onArchiveSession}
          onUnarchiveSession={onUnarchiveSession}
          onNewSessionInProject={onNewSessionInProject}
          statusMap={statusMap}
          searchQuery={searchQuery}
          questionSessionIds={questionSessionIds}
          errorSessionIds={errorSessionIds}
        />
      )}
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
  const { data: statusMap } = useSessionStatus();
  const { data: questions } = useQuestions();
  const questionSessionIds = useMemo(
    () => new Set((questions ?? []).map((q) => q.sessionID)),
    [questions],
  );
  const errorSessionIdsArr = useSessionErrorStore((s) => s.errors);
  const errorSessionIds = useMemo(
    () => new Set(errorSessionIdsArr),
    [errorSessionIdsArr],
  );
  const { data: portalConfig } = usePortalConfig();
  const baseDirs = portalConfig?.baseDirs ?? [];
  const { data: projectPathsResp } = useProjectPaths();
  const emptyProjectPaths = projectPathsResp?.paths ?? [];
  const sessions: Session[] = sessionsData ?? [];
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [notifPermission, setNotifPermission] =
    useState<NotificationPermission>(
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "denied",
    );

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

  useStatusNotifications({
    sessions,
    statusMap,
    currentSessionId,
  });

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
          </SidebarSection>

          <div className="col-span-full px-2 pb-1">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setSearchQuery(searchInput.trim());
                } else if (e.key === "Escape") {
                  setSearchInput("");
                  setSearchQuery("");
                }
              }}
              placeholder="Search sessions..."
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <SidebarSection label="Projects">
            <ProjectsList
              sessions={sessions}
              currentSessionId={currentSessionId}
              virtualDirectory={virtualDirectory ?? null}
              statusMap={statusMap}
              searchQuery={searchQuery}
              baseDirs={baseDirs}
              emptyProjectPaths={emptyProjectPaths}
              questionSessionIds={questionSessionIds}
              errorSessionIds={errorSessionIds}
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

            {notifPermission === "default" && (
              <MenuItem
                onAction={async () => {
                  const result = await requestNotificationPermission();
                  setNotifPermission(result);
                }}
              >
                <BellAlertIcon />
                Enable notifications
              </MenuItem>
            )}
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
