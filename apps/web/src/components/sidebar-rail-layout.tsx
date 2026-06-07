import { useMemo } from "react";
import { FolderPlusIcon } from "@heroicons/react/24/solid";
import type { Session } from "@opencode-ai/sdk";

import { ProjectIdenticon } from "@/components/project-identicon";
import { useSidebar } from "@/components/ui/sidebar";
import {
  resolveProjectPath,
  type BaseDirEntry,
} from "@/lib/project-path";
import {
  newSessionDraftKey,
  sessionHasDraft,
  sessionHasNewContent,
  SessionStatusDot,
  DraftIndicator,
} from "@/lib/session-indicators";
import type { SessionStatusMap } from "@/hooks/use-opencode";

interface RailProjectBin {
  dir: string;
  topSessions: Session[];
  allSessionIds: Set<string>;
}

interface RailProjectAggregate {
  status: "busy" | "retry" | undefined;
  newContent: boolean;
  draft: boolean;
  question: boolean;
  error: boolean;
  childBusy: boolean;
}

function projectBasename(directory: string): string {
  const trimmed = directory.replace(/\/+$/g, "");
  const last = trimmed.split("/").pop();
  return last || directory;
}

function projectInitial(directory: string): string {
  const name = projectBasename(directory);
  const firstChar = name.replace(/^[._-]+/, "").charAt(0);
  return (firstChar || name.charAt(0) || "?").toUpperCase();
}

function isArchivedTime(session: Session): boolean {
  const t = (session.time as { archived?: number } | undefined)?.archived;
  return typeof t === "number" && t > 0;
}

// Walk a session's parentID chain back to its top-level ancestor and
// return that ancestor's directory. Used to slot subagent sessions into
// the same project bin as their parent (the parent is what the user
// actually opened; subagent indicators must bubble up to that project).
function topLevelDirectory(
  session: Session,
  byId: Map<string, Session>,
): string | undefined {
  let current: Session | undefined = session;
  let guard = 0;
  while (current?.parentID && guard < 32) {
    const parent = byId.get(current.parentID);
    if (!parent) break;
    current = parent;
    guard++;
  }
  return current?.directory;
}

export interface SidebarRailLayoutProps {
  sessions: Session[];
  baseDirs: BaseDirEntry[];
  pinnedSessionIds: string[];
  statusMap: SessionStatusMap | undefined;
  questionSessionIds: Set<string>;
  errorSessionIds: Set<string>;
  lastViewedMap: Record<string, number>;
  currentSessionId: string | undefined;
  onOpenDirectory: () => void;
  onSelectSession: () => void;
}

export function SidebarRailLayout({
  sessions,
  baseDirs,
  pinnedSessionIds,
  statusMap,
  questionSessionIds,
  errorSessionIds,
  lastViewedMap,
  currentSessionId,
  onOpenDirectory,
  onSelectSession,
}: SidebarRailLayoutProps) {
  const { setDesktopMode } = useSidebar();

  const bins = useMemo<RailProjectBin[]>(() => {
    const byId = new Map<string, Session>();
    for (const s of sessions) byId.set(s.id, s);

    const map = new Map<string, RailProjectBin>();
    for (const s of sessions) {
      if (isArchivedTime(s)) continue;
      const sourceDir = s.parentID
        ? topLevelDirectory(s, byId) ?? s.directory ?? ""
        : s.directory ?? "";
      if (!sourceDir) continue;
      const projectPath =
        baseDirs.length > 0
          ? resolveProjectPath(sourceDir, baseDirs)
          : sourceDir;
      let bin = map.get(projectPath);
      if (!bin) {
        bin = { dir: projectPath, topSessions: [], allSessionIds: new Set() };
        map.set(projectPath, bin);
      }
      bin.allSessionIds.add(s.id);
      if (!s.parentID) bin.topSessions.push(s);
    }
    const sortByActivity = (a: Session, b: Session) =>
      (b.time?.updated ?? b.time?.created ?? 0) -
      (a.time?.updated ?? a.time?.created ?? 0);
    for (const bin of map.values()) bin.topSessions.sort(sortByActivity);
    return Array.from(map.values()).filter(
      (bin) => bin.topSessions.length > 0,
    );
  }, [sessions, baseDirs]);

  // Pinned-rank: a project ranks by the LOWEST index in pinnedSessionIds
  // among any session that lives inside it. Projects with no pinned
  // session get Infinity and fall through to the activity-sort branch.
  const sortedBins = useMemo(() => {
    const pinIndex = new Map<string, number>();
    pinnedSessionIds.forEach((id, idx) => pinIndex.set(id, idx));
    const ranked = bins.map((bin) => {
      let bestPinIdx = Infinity;
      for (const id of bin.allSessionIds) {
        const idx = pinIndex.get(id);
        if (idx !== undefined && idx < bestPinIdx) bestPinIdx = idx;
      }
      const lastActivity =
        bin.topSessions[0]?.time?.updated ??
        bin.topSessions[0]?.time?.created ??
        0;
      return { bin, pinRank: bestPinIdx, activity: lastActivity };
    });
    ranked.sort((a, b) => {
      if (a.pinRank !== b.pinRank) return a.pinRank - b.pinRank;
      return b.activity - a.activity;
    });
    return ranked.map((r) => r.bin);
  }, [bins, pinnedSessionIds]);

  return (
    <div className="flex flex-col items-center gap-1 px-1 py-2">
      <RailTile
        seedKey="__open_directory__"
        label="Open directory"
        onClick={onOpenDirectory}
        contentOverride={
          <span className="flex size-full items-center justify-center rounded-md bg-sidebar-accent/30 text-sidebar-fg/80 ring-1 ring-sidebar-border">
            <FolderPlusIcon className="size-5" />
          </span>
        }
      />
      <div className="my-1 h-px w-7 bg-sidebar-border/60" aria-hidden />
      {sortedBins.map((bin) => {
        const aggregate = aggregateBinSignals(
          bin,
          statusMap,
          questionSessionIds,
          errorSessionIds,
          lastViewedMap,
          currentSessionId,
          sessions,
        );
        const target = bin.topSessions[0];
        const isCurrentInProject = target ? bin.allSessionIds.has(currentSessionId ?? "") : false;
        return (
          <RailTile
            key={bin.dir}
            seedKey={bin.dir}
            label={bin.dir}
            isCurrent={isCurrentInProject}
            indicator={aggregate}
            href={target ? `/session/${target.id}` : undefined}
            onClick={target ? onSelectSession : undefined}
            onContextMenu={(event) => {
              event.preventDefault();
              setDesktopMode("full");
              if (typeof window !== "undefined") {
                requestAnimationFrame(() => {
                  const el = document.querySelector(
                    `[data-project-dir="${CSS.escape(bin.dir)}"]`,
                  );
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              }
            }}
          />
        );
      })}
    </div>
  );
}

function aggregateBinSignals(
  bin: RailProjectBin,
  statusMap: SessionStatusMap | undefined,
  questionSessionIds: Set<string>,
  errorSessionIds: Set<string>,
  lastViewedMap: Record<string, number>,
  currentSessionId: string | undefined,
  allSessions: Session[],
): RailProjectAggregate {
  let busy = false;
  let retry = false;
  let newContent = false;
  let draft = sessionHasDraft(newSessionDraftKey(bin.dir));
  let question = false;
  let error = false;
  let childBusy = false;

  for (const session of allSessions) {
    if (!bin.allSessionIds.has(session.id)) continue;
    const status = statusMap?.[session.id]?.type;
    if (status === "busy") {
      if (session.parentID) childBusy = true;
      else busy = true;
    } else if (status === "retry") {
      if (session.parentID) childBusy = true;
      else retry = true;
    }
    if (!session.parentID) {
      if (sessionHasNewContent(session, lastViewedMap, currentSessionId))
        newContent = true;
      if (sessionHasDraft(session.id)) draft = true;
    }
    if (questionSessionIds.has(session.id)) question = true;
    if (errorSessionIds.has(session.id)) error = true;
  }
  return {
    status: busy ? "busy" : retry ? "retry" : undefined,
    newContent,
    draft,
    question,
    error,
    childBusy,
  };
}

interface RailTileProps {
  seedKey: string;
  label: string;
  isCurrent?: boolean;
  indicator?: RailProjectAggregate;
  contentOverride?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
}

function RailTile({
  seedKey,
  label,
  isCurrent,
  indicator,
  contentOverride,
  href,
  onClick,
  onContextMenu,
}: RailTileProps) {
  const initial = projectInitial(seedKey);
  const showIndicator =
    indicator &&
    (indicator.status ||
      indicator.newContent ||
      indicator.draft ||
      indicator.question ||
      indicator.error ||
      indicator.childBusy);
  const Component = href ? "a" : "button";
  return (
    <Component
      {...(href ? { href } : { type: "button" })}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={label}
      title={label}
      className={`group/rail-tile relative size-11 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring transition-shadow ${
        isCurrent
          ? "ring-2 ring-primary"
          : "hover:ring-2 hover:ring-sidebar-border"
      }`}
    >
      {contentOverride ?? (
        <span className="relative block size-full overflow-hidden rounded-md bg-sidebar-accent/30 ring-1 ring-sidebar-border">
          <ProjectIdenticon
            seed={seedKey}
            size={44}
            className="absolute inset-0 size-full"
          />
          <span className="absolute inset-0 flex items-center justify-center font-semibold text-sidebar-fg/90 text-sm drop-shadow-[0_1px_1px_rgb(0_0_0_/_0.6)] mix-blend-luminosity">
            {initial}
          </span>
        </span>
      )}
      {showIndicator && indicator && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center gap-0.5 rounded-full bg-sidebar/90 px-0.5 py-0.5 ring-1 ring-sidebar-border">
          {indicator.draft && <DraftIndicator hasDraft reserveSpace={false} />}
          <SessionStatusDot
            status={indicator.status}
            hasNewContent={indicator.newContent}
            hasQuestion={indicator.question}
            hasError={indicator.error}
            hasChildBusy={indicator.childBusy}
            reserveSpace={false}
          />
        </span>
      )}
    </Component>
  );
}
