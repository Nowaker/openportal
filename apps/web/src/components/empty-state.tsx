import {
  ChevronRightIcon,
  ArchiveBoxIcon,
  ArchiveBoxArrowDownIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconGridPlus } from "@/components/icons/grid-plus-icon";
import { Button } from "@/components/ui/button";
import { Keyboard } from "@/components/ui/keyboard";
import { Link } from "@/components/ui/link";
import useMediaQuery from "@/hooks/use-media-query";
import {
  useSessions,
  useCreateSession,
  useArchiveSession,
  useUnarchiveSession,
} from "@/hooks/use-opencode";
import type { Session } from "@opencode-ai/sdk";

function isArchived(s: Session): boolean {
  const t = (s.time as { archived?: number } | undefined)?.archived;
  return typeof t === "number" && t > 0;
}

function projectBasename(directory: string): string {
  const trimmed = directory.replace(/\/+$/g, "");
  const last = trimmed.split("/").pop();
  return last || directory;
}

interface MobileBin {
  dir: string;
  sessions: Session[];
  archivedSessions: Session[];
}

function groupSessionsByDirectory(sessions: Session[]): MobileBin[] {
  const byDir = new Map<string, MobileBin>();
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
      (b.sessions[0]?.time?.updated ?? b.sessions[0]?.time?.created ?? 0) -
      (a.sessions[0]?.time?.updated ?? a.sessions[0]?.time?.created ?? 0),
  );
  return arr;
}

function truncateTitle(title: string, maxLength = 40): string {
  if (title.length <= maxLength) return title;
  const halfLength = Math.floor((maxLength - 3) / 2);
  return `${title.slice(0, halfLength)}...${title.slice(-halfLength)}`;
}

export default function EmptyState() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { isMobile } = useMediaQuery();
  const { data: sessionsData, error, isLoading, mutate } = useSessions();
  const createSession = useCreateSession();
  const archiveSession = useArchiveSession();
  const unarchiveSession = useUnarchiveSession();

  const sessions: Session[] = sessionsData ?? [];

  const handleNewSession = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newSession = await createSession();
      await mutate();
      navigate({
        to: "/session/$id",
        params: { id: newSession.id },
        search: (prev) => prev,
      });
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      setCreating(false);
    }
  }, [creating, createSession, mutate, navigate]);

  async function handleArchive(sessionId: string) {
    try {
      await archiveSession(sessionId);
      await mutate();
    } catch (err) {
      console.error("Failed to archive session:", err);
    }
  }

  async function handleUnarchive(sessionId: string) {
    try {
      await unarchiveSession(sessionId);
      await mutate();
    } catch (err) {
      console.error("Failed to unarchive session:", err);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter" && event.shiftKey && !creating) {
        event.preventDefault();
        handleNewSession();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [creating, handleNewSession]);

  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-col items-center pt-8 pb-6">
          <div className="flex items-center gap-x-2 mb-2">
            <img src="/logo.svg" alt="OpenCode Portal" className="size-8" />
            <h2 className="text-2xl font-medium text-fg">
              OpenCode <span className="text-muted-fg">Portal</span>
            </h2>
          </div>
        </div>

        <div className="px-4 pb-4">
          <Button
            intent="outline"
            onPress={handleNewSession}
            isDisabled={creating}
            className="w-full"
          >
            <IconGridPlus className="shrink-0" />
            {creating ? "Creating..." : "New Session"}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4">
          <h3 className="text-sm font-medium text-muted-fg mb-2">Projects</h3>

          {isLoading && (
            <p className="text-sm text-muted-fg py-2">Loading sessions...</p>
          )}

          {error && (
            <p className="text-sm text-danger py-2">Error: {error.message}</p>
          )}

          {!isLoading && !error && sessions.length === 0 && (
            <p className="text-sm text-muted-fg py-2">No sessions found</p>
          )}

          {!isLoading && !error && sessions.length > 0 && (
            <ProjectsListMobile
              sessions={sessions}
              onArchiveSession={handleArchive}
              onUnarchiveSession={handleUnarchive}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-x-2 mb-4">
          <img src="/logo.svg" alt="OpenCode Portal" className="size-8" />
          <h2 className="text-2xl font-medium text-fg">OpenCode Portal</h2>
        </div>
        <p className="text-muted-fg mb-6">
          Select an existing session from the left panel or create a new one to
          get started
        </p>
        <div className="space-y-1.5 text-sm text-muted-fg">
          <div>
            Press{" "}
            <Keyboard className="inline-flex px-1.5 py-0.5 rounded bg-secondary text-secondary-fg text-xs font-mono">
              Shift + Enter
            </Keyboard>{" "}
            to start a new session
          </div>
          <div>
            Or press{" "}
            <Keyboard className="inline-flex px-1.5 py-0.5 rounded bg-secondary text-secondary-fg text-xs font-mono">
              {typeof navigator !== "undefined" &&
              /Mac|iPhone|iPad/.test(navigator.platform)
                ? "⌘ K"
                : "Ctrl + K"}
            </Keyboard>{" "}
            for the command palette
          </div>
        </div>
      </div>
    </div>
  );
}

interface ProjectsListMobileProps {
  sessions: Session[];
  onArchiveSession: (id: string) => void;
  onUnarchiveSession: (id: string) => void;
}

function ProjectsListMobile({
  sessions,
  onArchiveSession,
  onUnarchiveSession,
}: ProjectsListMobileProps) {
  const groups = useMemo(() => groupSessionsByDirectory(sessions), [sessions]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  return (
    <ul className="space-y-1">
      {groups.map((group) => {
        const isExpanded = expanded.has(group.dir);
        return (
          <ProjectGroupMobile
            key={group.dir}
            directory={group.dir}
            sessions={group.sessions}
            archivedSessions={group.archivedSessions}
            isExpanded={isExpanded}
            onToggle={() => toggle(group.dir)}
            onArchiveSession={onArchiveSession}
            onUnarchiveSession={onUnarchiveSession}
          />
        );
      })}
    </ul>
  );
}

interface ProjectGroupMobileProps {
  directory: string;
  sessions: Session[];
  archivedSessions: Session[];
  isExpanded: boolean;
  onToggle: () => void;
  onArchiveSession: (id: string) => void;
  onUnarchiveSession: (id: string) => void;
}

function ProjectGroupMobile({
  directory,
  sessions,
  archivedSessions,
  isExpanded,
  onToggle,
  onArchiveSession,
  onUnarchiveSession,
}: ProjectGroupMobileProps) {
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

  return (
    <li className="rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        title={directory}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 rounded hover:bg-secondary/50 transition-colors"
      >
        <ChevronRightIcon
          className={`size-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
        />
        <span className="text-sm truncate flex-1 text-left">
          {projectBasename(directory)}
          {sessions.length > 0 && (
            <span className="ml-1 text-muted-fg">({sessions.length})</span>
          )}
        </span>
      </button>
      {visible.map((session) => (
        <div
          key={session.id}
          className="flex items-center justify-between pl-6 rounded hover:bg-secondary/50"
        >
          <Link
            href={`/session/${session.id}`}
            className="flex-1 py-2 px-3 text-sm truncate"
          >
            {truncateTitle(
              session.title || `Session ${session.id.slice(0, 8)}`,
            )}
          </Link>
          <button
            type="button"
            onClick={() => onArchiveSession(session.id)}
            title="Archive session"
            aria-label={`Archive ${session.title}`}
            className="shrink-0 inline-flex items-center justify-center size-8 rounded text-muted-fg hover:text-fg hover:bg-secondary/50"
          >
            <ArchiveBoxArrowDownIcon className="size-4" />
          </button>
        </div>
      ))}
      {isExpanded && remaining > 0 && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 10)}
          className="text-xs text-muted-fg hover:text-fg pl-6 px-3 py-1 text-left"
        >
          Load {Math.min(10, remaining)} more
        </button>
      )}
      {isExpanded && archivedSessions.length > 0 && (
        <button
          type="button"
          onClick={() => setArchivedExpanded((v) => !v)}
          className="flex items-center gap-1.5 pl-6 px-2 py-1 text-xs text-muted-fg hover:text-fg w-full text-left"
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
          className="flex items-center justify-between pl-12 rounded hover:bg-secondary/50 text-muted-fg"
        >
          <Link
            href={`/session/${session.id}`}
            className="flex-1 py-2 px-3 text-sm italic truncate"
          >
            {truncateTitle(
              session.title || `Session ${session.id.slice(0, 8)}`,
            )}
          </Link>
          <button
            type="button"
            onClick={() => onUnarchiveSession(session.id)}
            title="Unarchive session"
            aria-label={`Unarchive ${session.title}`}
            className="shrink-0 inline-flex items-center justify-center size-8 rounded text-muted-fg hover:text-fg hover:bg-secondary/50"
          >
            <ArrowUturnLeftIcon className="size-4" />
          </button>
        </div>
      ))}
      {archivedExpanded && archivedRemaining > 0 && (
        <button
          type="button"
          onClick={() => setArchivedLimit((l) => l + 10)}
          className="text-xs text-muted-fg hover:text-fg pl-12 px-3 py-1 text-left"
        >
          Load {Math.min(10, archivedRemaining)} more
        </button>
      )}
    </li>
  );
}
