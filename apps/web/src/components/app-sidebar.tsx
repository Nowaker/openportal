import {
  ChevronUpDownIcon,
  ChevronRightIcon,
  ArchiveBoxIcon,
  ServerStackIcon,
  ArchiveBoxArrowDownIcon,
  ArrowUturnLeftIcon,
  BellAlertIcon,
  CodeBracketIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  Cog6ToothIcon,
  PlusIcon,
  FolderOpenIcon,
} from "@heroicons/react/24/solid";
import { useEffect, useState, useMemo, Fragment } from "react";
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
  usePermissions,
  usePortalConfig,
  useProjectPaths,
  type SessionStatusMap,
} from "@/hooks/use-opencode";
import { useSessionErrorStore } from "@/stores/session-error-store";
import { useLastViewed, useMarkManyViewed } from "@/hooks/use-last-viewed";
import {
  usePinnedSessions,
  useTogglePinnedSession,
} from "@/hooks/use-pinned-sessions";
import {
  resolveProjectPath,
  buildProjectTree,
  groupSessionsByParent,
  cascadeIdsToAncestors,
  type BaseDirEntry,
  type ProjectTreeNode,
} from "@/lib/project-path";

import {
  sessionHasDraft,
  sessionHasNewContent,
  SessionStatusDot,
  DraftIndicator,
} from "@/lib/session-indicators";
import { useInstanceStore } from "@/stores/instance-store";
import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";
import { useNavigate, useMatch } from "@tanstack/react-router";
import type { Session } from "@opencode-ai/sdk";
import { FolderBrowserDialog } from "@/components/folder-browser";
import { CreateProjectModal } from "@/components/create-project-modal";
import { SidebarRailLayout } from "@/components/sidebar-rail-layout";
import { mutate as swrMutate } from "swr";
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
  lastViewedMap: Record<string, number>;
  childrenByParent: Map<string, Session[]>;
  displayName?: string;
  depth?: number;
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
  lastViewedMap,
  childrenByParent,
  displayName,
  depth = 0,
}: ProjectGroupProps) {
  const subsExpanded = useSidebarExpandStore((s) => s.expanded);
  const subsExpandedSet = useMemo(() => new Set(subsExpanded), [subsExpanded]);
  const subsForceCollapsed = useSidebarExpandStore((s) => s.forceCollapsed);
  const subsForceCollapsedSet = useMemo(
    () => new Set(subsForceCollapsed),
    [subsForceCollapsed],
  );
  const setSubsExplicitCollapsed = useSidebarExpandStore(
    (s) => s.setExplicitCollapsed,
  );
  const expandSubs = useSidebarExpandStore((s) => s.expand);
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
    if (searchQuery) {
      return { rows: sessions, count: sessions.length };
    }
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
  }, [isExpanded, sessions, limit, currentSessionId, searchQuery]);
  const visible = visibleAndCount.rows;
  const remaining = sessions.length - visibleAndCount.count;
  // When searching, auto-reveal all matching archived sessions even if
  // the archived section was collapsed - search must surface every match
  // regardless of the gate that would normally hide it.
  const archivedVisible = searchQuery
    ? archivedSessions
    : archivedExpanded
      ? archivedSessions.slice(0, archivedLimit)
      : [];
  const archivedRemaining = archivedSessions.length - archivedVisible.length;
  const projectName = displayName ?? projectBasename(directory);
  const containsCurrent =
    sessions.some((s) => s.id === currentSessionId) ||
    archivedSessions.some((s) => s.id === currentSessionId);
  // Project header AND its session rows share the same paddingLeft so the
  // sessions' indicators (after a chevron-width invisible spacer added
  // below) line up with the project's indicators above. Only the chevron
  // and the spacer differ - everything past them is at the same x.
  const headerPaddingLeft = depth > 0 ? `${0.5 + depth * 0.75}rem` : undefined;
  const headerStyle = headerPaddingLeft
    ? { paddingLeft: headerPaddingLeft }
    : undefined;
  const sessionRowStyle = headerPaddingLeft
    ? { paddingLeft: headerPaddingLeft }
    : undefined;

  // Indicator cascade rule (per user spec): show the aggregated indicator
  // on the project header only when the project is COLLAPSED, i.e. the
  // user can't see any sessions inside. When expanded, each visible
  // session row carries its own indicator; cascading would just duplicate
  // the signal. The empty-slot placeholders inside DraftIndicator /
  // SessionStatusDot keep the title's x-coordinate stable across
  // expanded/collapsed transitions.
  let aggBusy = false;
  let aggRetry = false;
  let aggNewContent = false;
  let aggDraft = false;
  let aggQuestion = false;
  let aggError = false;
  if (!isExpanded) {
    for (const s of sessions) {
      const t = statusMap?.[s.id]?.type;
      if (t === "busy") aggBusy = true;
      else if (t === "retry") aggRetry = true;
      if (sessionHasNewContent(s, lastViewedMap, currentSessionId))
        aggNewContent = true;
      if (sessionHasDraft(s.id)) aggDraft = true;
      if (questionSessionIds.has(s.id)) aggQuestion = true;
      if (errorSessionIds.has(s.id)) aggError = true;
    }
  }
  const aggStatus: "busy" | "retry" | undefined = aggBusy
    ? "busy"
    : aggRetry
      ? "retry"
      : undefined;

  return (
    <>
      <div
        className={`col-span-full flex items-center gap-1 ${depth > 0 ? "pr-3" : "px-3"} py-1 rounded hover:bg-muted/20 transition-colors`}
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
          <DraftIndicator hasDraft={aggDraft} />
          <SessionStatusDot
            status={aggStatus}
            hasNewContent={aggNewContent}
            hasQuestion={aggQuestion}
            hasError={aggError}
          />
          <span className="text-xs sm:text-sm truncate ml-px">
            {highlightMatch(projectName, searchQuery)}
            {sessions.length > 0 && (
              <span className="ml-1 text-muted-fg">({sessions.length})</span>
            )}
          </span>
        </button>
        <a
          href={`vscode://file${encodeURI(directory.replace(/\/+$/, ""))}/`}
          onClick={(e) => e.stopPropagation()}
          title={`Open ${directory} in VS Code`}
          aria-label={`Open ${projectName} in VS Code`}
          className="shrink-0 inline-flex items-center justify-center size-6 rounded text-muted-fg hover:text-fg hover:bg-muted/50"
        >
          <CodeBracketIcon className="size-3.5" />
        </a>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNewSessionInProject();
          }}
          title={`New session in ${directory}`}
          aria-label={`New session in ${projectName}`}
          className="shrink-0 inline-flex items-center justify-center size-6 rounded text-muted-fg hover:text-fg hover:bg-muted/50"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      {visible.map((session) => {
        const status = statusMap?.[session.id]?.type;
        const hasDraft = sessionHasDraft(session.id);
        const hasNewContent = sessionHasNewContent(
          session,
          lastViewedMap,
          currentSessionId,
        );
        const hasQuestion = questionSessionIds.has(session.id);
        const hasError = errorSessionIds.has(session.id);
        const isCurrent = session.id === currentSessionId;

        const children = childrenByParent.get(session.id) || [];
        const hasChildren = children.length > 0;
        const childAnyQuestion = hasChildren
          ? children.some((c) => questionSessionIds.has(c.id))
          : false;
        const childAnyError = hasChildren
          ? children.some((c) => errorSessionIds.has(c.id))
          : false;
        const childAnyBusy = hasChildren
          ? children.some((c) => {
              const t = statusMap?.[c.id]?.type;
              return t === "busy" || t === "retry";
            })
          : false;
        const subsKey = `subs:${session.id}`;
        const explicitlyExpanded = subsExpandedSet.has(subsKey);
        const explicitlyCollapsed = subsForceCollapsedSet.has(subsKey);
        const containsCurrent =
          !!currentSessionId &&
          children.some((c) => c.id === currentSessionId);
        const shouldAutoExpand =
          childAnyBusy || childAnyQuestion || childAnyError || containsCurrent;
        const isSubsExpanded =
          hasChildren &&
          !explicitlyCollapsed &&
          (explicitlyExpanded || shouldAutoExpand);

        const showHasQuestion =
          hasQuestion || (hasChildren && !isSubsExpanded && childAnyQuestion);
        const showHasError =
          hasError || (hasChildren && !isSubsExpanded && childAnyError);
        const showHasChildBusy =
          hasChildren && !isSubsExpanded && childAnyBusy;

        return (
          <Fragment key={session.id}>
            <div
              className={`col-span-full flex items-center gap-1 ${depth > 0 ? "pr-3" : "pl-3 pr-3"} rounded ${isCurrent ? "bg-primary/15" : "hover:bg-muted/20"}`}
              style={depth > 0 ? sessionRowStyle : undefined}
              data-current-session={isCurrent || undefined}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => {
                    if (isSubsExpanded) {
                      setSubsExplicitCollapsed(subsKey, true);
                    } else {
                      setSubsExplicitCollapsed(subsKey, false);
                      expandSubs(subsKey);
                    }
                  }}
                  aria-label={
                    isSubsExpanded ? "Collapse subsessions" : "Expand subsessions"
                  }
                  title={
                    isSubsExpanded ? "Collapse subsessions" : "Expand subsessions"
                  }
                  className="size-3 shrink-0 inline-flex items-center justify-center text-muted-fg hover:text-fg"
                >
                  <ChevronRightIcon
                    className={`size-3 transition-transform ${isSubsExpanded ? "rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <span className="size-3 shrink-0" aria-hidden />
              )}
              <DraftIndicator hasDraft={hasDraft} />
              <SessionStatusDot
                status={status}
                hasNewContent={hasNewContent}
                hasQuestion={showHasQuestion}
                hasError={showHasError}
                hasChildBusy={showHasChildBusy}
              />
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
            {isSubsExpanded &&
              children.map((child) => {
                const childStatus = statusMap?.[child.id]?.type;
                const childHasNew = sessionHasNewContent(
                  child,
                  lastViewedMap,
                  currentSessionId,
                );
                const childIsCurrent = child.id === currentSessionId;
                return (
                  <div
                    key={child.id}
                    className={`col-span-full flex items-center gap-1 pr-3 rounded ${
                      childIsCurrent ? "bg-primary/15" : "hover:bg-muted/20"
                    }`}
                    style={{
                      paddingLeft: depth > 0 ? `calc(${headerPaddingLeft} + 1.25rem)` : "2rem",
                    }}
                  >
                    <span className="size-3 shrink-0" aria-hidden />
                    <DraftIndicator hasDraft={sessionHasDraft(child.id)} />
                    <SessionStatusDot
                      status={childStatus}
                      hasNewContent={childHasNew}
                      hasQuestion={questionSessionIds.has(child.id)}
                      hasError={errorSessionIds.has(child.id)}
                      subagent
                    />
                    <UILink
                      href={`/session/${child.id}`}
                      onClick={onSessionClick}
                      className="flex-1 min-w-0 py-0.5 text-xs text-sidebar-fg hover:text-fg truncate block"
                    >
                      {highlightMatch(
                        truncateTitle(child.title || "(untitled)"),
                        searchQuery,
                      )}
                    </UILink>
                  </div>
                );
              })}
          </Fragment>
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
          className="col-span-full flex items-center gap-1 pl-3 pr-3 py-0.5 text-[11px] text-muted-fg hover:text-fg text-left"
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
  lastViewedMap: Record<string, number>;
  home: string;
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
  lastViewedMap,
  home,
}: ProjectsListProps) {
  const childrenByParent = useMemo(
    () => groupSessionsByParent(sessions),
    [sessions],
  );
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
    // Force-expand every match's path AND all its ancestor path segments,
    // so a session under ~/projekty/cat/proj surfaces even when the parent
    // category was collapsed when search began.
    const out = new Set<string>();
    for (const g of filteredGroups) {
      out.add(g.dir);
      let cursor = g.dir;
      while (cursor.lastIndexOf("/") > 0) {
        cursor = cursor.slice(0, cursor.lastIndexOf("/"));
        out.add(cursor);
        if (baseDirs.some((b) => b.path === cursor)) break;
      }
    }
    return out;
  }, [filteredGroups, searchQuery, baseDirs]);

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
      (bin) => {
        for (const s of bin.sessions) {
          const t = statusMap?.[s.id]?.type;
          if (t === "busy" || t === "retry") return true;
          if (questionSessionIds.has(s.id)) return true;
          if (errorSessionIds.has(s.id)) return true;
          if (sessionHasNewContent(s, lastViewedMap, currentSessionId))
            return true;
          if (sessionHasDraft(s.id)) return true;
        }
        return false;
      },
    );
  }, [
    baseDirs,
    binMap,
    statusMap,
    questionSessionIds,
    errorSessionIds,
    lastViewedMap,
    currentSessionId,
  ]);

  // Group top-level nodes BY base dir so each base can render with its own
  // path header. Each base-dir root container is unwrapped: its children
  // become top-level rows for that section. If the base itself is a project
  // (rare: session.directory === base.path), surface it as a sibling leaf.
  const sections = useMemo<
    Array<{ basePath: string; nodes: ProjectTreeNode<ProjectBin>[] }>
  >(() => {
    if (baseDirs.length === 0) {
      return [
        {
          basePath: "",
          nodes: filteredGroups.map((g) => ({
            name: projectBasename(g.dir),
            path: g.dir,
            isProject: true,
            bin: g,
            children: [],
          })),
        },
      ];
    }
    return trees.map((root) => {
      const nodes: ProjectTreeNode<ProjectBin>[] = [];
      if (root.children.length > 0) {
        nodes.push(...root.children);
        if (root.isProject && root.bin) {
          nodes.push({ ...root, children: [] });
        }
      } else if (root.isProject) {
        nodes.push(root);
      }
      return { basePath: root.path, nodes };
    });
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
    <>
      <PinnedSection
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionClick={onSessionClick}
        statusMap={statusMap}
        questionSessionIds={questionSessionIds}
        errorSessionIds={errorSessionIds}
        lastViewedMap={lastViewedMap}
      />
      {sections.map((section, idx) => (
        <Fragment key={section.basePath || `unset-${idx}`}>
          {section.basePath && (
            <div
              className="col-span-full pt-2 pb-1 px-3 text-[11px] text-muted-fg"
              title={section.basePath}
            >
              <CompactPath path={section.basePath} home={home} />
            </div>
          )}
          <TreeChildren
            nodes={section.nodes}
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
            lastViewedMap={lastViewedMap}
            childrenByParent={childrenByParent}
          />
        </Fragment>
      ))}
      <ProjectsListBottomActions
        sessions={sessions}
        lastViewedMap={lastViewedMap}
        currentSessionId={currentSessionId}
      />
    </>
  );
}

function PinnedSection({
  sessions,
  currentSessionId,
  onSessionClick,
  statusMap,
  questionSessionIds,
  errorSessionIds,
  lastViewedMap,
}: {
  sessions: Session[];
  currentSessionId: string | undefined;
  onSessionClick: () => void;
  statusMap: SessionStatusMap | undefined;
  questionSessionIds: Set<string>;
  errorSessionIds: Set<string>;
  lastViewedMap: Record<string, number>;
}) {
  const { data } = usePinnedSessions();
  const togglePin = useTogglePinnedSession();
  const navigate = useNavigate();
  const pinned = data?.sessions ?? [];
  const rows = pinned
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => Boolean(s));
  if (rows.length === 0) return null;
  return (
    <Fragment>
      <div className="col-span-full pt-2 pb-1 px-3 text-[11px] text-muted-fg">
        Pinned
      </div>
      <div className="col-span-full px-1">
        {rows.map((session) => {
          const status = statusMap?.[session.id]?.type;
          const hasNewContent = sessionHasNewContent(
            session,
            lastViewedMap,
            currentSessionId,
          );
          const hasQuestion = questionSessionIds.has(session.id);
          const hasError = errorSessionIds.has(session.id);
          const hasDraft = sessionHasDraft(session.id);
          const isCurrent = session.id === currentSessionId;
          return (
            <div
              key={session.id}
              className={`group flex items-center gap-1.5 rounded-md px-2 py-1 ${
                isCurrent ? "bg-primary/15" : "hover:bg-muted/40"
              }`}
            >
              <DraftIndicator hasDraft={hasDraft} />
              <SessionStatusDot
                status={status}
                hasNewContent={hasNewContent}
                hasQuestion={hasQuestion}
                hasError={hasError}
              />
              <button
                type="button"
                onClick={() => {
                  onSessionClick();
                  void navigate({
                    to: "/session/$id",
                    params: { id: session.id },
                  });
                }}
                className="flex-1 min-w-0 truncate text-left text-xs sm:text-sm text-sidebar-fg hover:text-fg"
              >
                {session.title || "(untitled)"}
              </button>
              <button
                type="button"
                onClick={() => void togglePin(session.id, "unpin")}
                title="Unpin"
                aria-label={`Unpin ${session.title || "session"}`}
                className="shrink-0 inline-flex items-center justify-center size-6 rounded text-muted-fg hover:text-fg hover:bg-muted/50"
              >
                <XMarkIcon className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Fragment>
  );
}

// Bottom row of less-frequently-used sidebar actions. Currently just one
// (mark-all-reviewed); add new entries here as siblings rather than further
// cluttering the per-project / per-session rows above.
function ProjectsListBottomActions({
  sessions,
  lastViewedMap,
  currentSessionId,
}: {
  sessions: Session[];
  lastViewedMap: Record<string, number>;
  currentSessionId: string | undefined;
}) {
  const markMany = useMarkManyViewed();
  const candidates = sessions.filter(
    (s) =>
      s.id !== currentSessionId &&
      sessionHasNewContent(s, lastViewedMap, currentSessionId),
  );
  if (candidates.length === 0) return null;
  return (
    <div className="col-span-full mt-2 px-3 py-1 border-t border-dashed border-border/50">
      <button
        type="button"
        onClick={() => {
          void markMany(candidates.map((s) => s.id));
        }}
        title={`Mark ${candidates.length} session${candidates.length === 1 ? "" : "s"} as reviewed`}
        className="text-[11px] text-muted-fg hover:text-fg py-0.5 text-left"
      >
        Mark {candidates.length} reviewed
      </button>
    </div>
  );
}

// Renders an absolute path with `~` substitution. The wrapper splits into
// a fixed prefix (always shown) plus a body using direction:rtl + ellipsis,
// which truncates from the LEFT - so when there's no room, the user sees
// `~/...end-of-path` rather than `~/start-of-pat...`. The wrapping span sets
// unicode-bidi:plaintext so the body still renders left-to-right visually.
function CompactPath({ path, home }: { path: string; home: string }) {
  const display = home && path.startsWith(home) ? "~" + path.slice(home.length) : path;
  if (display.length <= 24) {
    return <span className="block truncate">{display}</span>;
  }
  const slash = display.indexOf("/", 1);
  const head = slash > 0 ? display.slice(0, slash) : "~";
  const tail = slash > 0 ? display.slice(slash) : "";
  return (
    <span className="flex items-baseline gap-0 min-w-0">
      <span className="shrink-0">{head}</span>
      <span
        className="block truncate min-w-0"
        style={{ direction: "rtl", unicodeBidi: "plaintext" }}
      >
        {tail}
      </span>
    </span>
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
  lastViewedMap: Record<string, number>,
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
        if (sessionHasNewContent(s, lastViewedMap, currentSessionId)) acc.newContent = true;
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
  lastViewedMap: Record<string, number>;
  childrenByParent: Map<string, Session[]>;
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

  const effectiveLimit = rest.searchQuery ? empty.length : emptyLimit;
  const visibleEmpty = empty.slice(0, effectiveLimit);
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
  lastViewedMap: Record<string, number>;
  childrenByParent: Map<string, Session[]>;
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
  lastViewedMap,
  childrenByParent,
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
        lastViewedMap={lastViewedMap}
        childrenByParent={childrenByParent}
      />
    );
  }

  const [createOpen, setCreateOpen] = useState(false);
  const fullAggregate = aggregateNodeStatus(
    node,
    statusMap,
    currentSessionId,
    questionSessionIds,
    errorSessionIds,
    lastViewedMap,
  );
  const aggregate = isExpanded
    ? {
        ...fullAggregate,
        status: undefined,
        newContent: false,
        draft: false,
        question: false,
        error: false,
      }
    : fullAggregate;

  return (
    <>
      <div
        className="col-span-full flex items-center gap-1 pr-3 py-1 rounded hover:bg-muted/20 transition-colors"
        style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}
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
          <DraftIndicator hasDraft={aggregate.draft} />
          <SessionStatusDot
            status={aggregate.status}
            hasNewContent={aggregate.newContent}
            hasQuestion={aggregate.question}
            hasError={aggregate.error}
          />
          <span className="text-xs sm:text-sm truncate ml-px">
            {highlightMatch(node.name, searchQuery)}
            {aggregate.sessionCount > 0 && (
              <span className="ml-1 text-muted-fg">
                ({aggregate.sessionCount})
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCreateOpen(true);
          }}
          title={`New project in ${node.path}`}
          aria-label={`New project in ${node.name}`}
          className="shrink-0 inline-flex items-center justify-center size-6 rounded text-muted-fg hover:text-fg hover:bg-muted/50"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <CreateProjectModal
        isOpen={createOpen}
        parentPath={node.path}
        onOpenChange={setCreateOpen}
        onCreated={(newPath) => {
          void swrMutate("/api/fs/projects");
          onNewSessionInProject(newPath);
        }}
      />
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
          lastViewedMap={lastViewedMap}
          childrenByParent={childrenByParent}
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
  const { setIsOpenOnMobile, desktopMode, isMobile: sidebarIsMobile } = useSidebar();
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
  const { data: permissions } = usePermissions();
  // Pending permission requests are conceptually identical to questions for the
  // sidebar dot: both block the run on user input. Merge sources so a session
  // waiting on file/bash approval surfaces as red-attention, not amber-busy.
  // Then cascade the ids up the parentID chain so a question/permission on
  // a subagent surfaces on the parent main session too (which is what's
  // visible at the top level when the subagent group is collapsed).
  const questionSessionIds = useMemo(() => {
    const seed = new Set<string>();
    for (const q of questions ?? []) seed.add(q.sessionID);
    for (const p of (permissions ?? []) as Array<{ sessionID?: string }>) {
      if (p.sessionID) seed.add(p.sessionID);
    }
    return cascadeIdsToAncestors(seed, sessionsData ?? []);
  }, [questions, permissions, sessionsData]);
  const errorSessionIdsArr = useSessionErrorStore((s) => s.errors);
  const errorSessionIds = useMemo(
    () =>
      cascadeIdsToAncestors(
        new Set(errorSessionIdsArr),
        sessionsData ?? [],
      ),
    [errorSessionIdsArr, sessionsData],
  );
  const { data: lastViewedData } = useLastViewed();
  const lastViewedMap = lastViewedData ?? {};
  const { data: portalConfig } = usePortalConfig();
  const baseDirs = portalConfig?.baseDirs ?? [];
  const { data: projectPathsResp } = useProjectPaths();
  const emptyProjectPaths = projectPathsResp?.paths ?? [];
  const sessions: Session[] = sessionsData ?? [];
  const { data: pinnedData } = usePinnedSessions();
  const pinnedSessionIds = pinnedData?.sessions ?? [];
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
    questionSessionIds,
    onSelect: (id) => {
      void navigate({ to: "/session/$id", params: { id } });
    },
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
        {!sidebarIsMobile && desktopMode === "rail" ? (
          <SidebarRailLayout
            sessions={sessions}
            baseDirs={baseDirs}
            pinnedSessionIds={pinnedSessionIds}
            statusMap={statusMap}
            questionSessionIds={questionSessionIds}
            errorSessionIds={errorSessionIds}
            lastViewedMap={lastViewedMap}
            currentSessionId={currentSessionId}
            onOpenDirectory={() => setBrowserOpen(true)}
            onSelectSession={(id) =>
              navigate({ to: "/session/$id", params: { id } })
            }
          />
        ) : (
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

            <div className="col-span-full px-3 pb-1 relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchInput(v);
                  // Auto-submit empty query whenever the field becomes empty
                  // (backspace-to-zero or our X button below) so the filter
                  // resets in lock-step with the input.
                  if (v.length === 0) setSearchQuery("");
                }}
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
                className="w-full rounded border border-border bg-bg px-2 py-1 pr-7 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {searchInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                  aria-label="Clear search"
                  title="Clear search"
                  className="absolute top-1/2 right-4 -translate-y-1/2 inline-flex size-5 items-center justify-center rounded text-muted-fg hover:text-fg hover:bg-muted/50"
                >
                  <XMarkIcon className="size-3.5" />
                </button>
              )}
            </div>

            <SidebarSection>
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
                lastViewedMap={lastViewedMap}
                home={portalConfig?.home ?? ""}
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
        )}
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
                navigate({ to: "/prompts" });
              }}
            >
              <ArchiveBoxIcon />
              Prompt history
            </MenuItem>
            <MenuItem
              onAction={() => {
                setIsOpenOnMobile(false);
                if (
                  typeof window !== "undefined" &&
                  window.matchMedia("(min-width: 768px)").matches
                ) {
                  useFileBrowserPanelStore.getState().open("/");
                } else {
                  window.open("/files?path=/", "_blank", "noopener");
                }
              }}
            >
              <FolderOpenIcon />
              File browser (root)
            </MenuItem>
            <MenuItem
              onAction={() => {
                setIsOpenOnMobile(false);
                navigate({ to: "/servers" });
              }}
            >
              <ServerStackIcon />
              Server list
            </MenuItem>
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
        onSelect={(picked, autoPrompt) => {
          setIsOpenOnMobile(false);
          setVirtualDirectory(picked);
          navigate({
            to: "/session/new",
            search: autoPrompt
              ? { directory: picked, autoPrompt }
              : { directory: picked },
          });
        }}
      />
    </Sidebar>
  );
}
