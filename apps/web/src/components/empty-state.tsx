import { EllipsisHorizontalIcon } from "@heroicons/react/16/solid";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { TrashIcon } from "@heroicons/react/24/solid";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconGridPlus } from "@/components/icons/grid-plus-icon";
import { Button } from "@/components/ui/button";
import { Keyboard } from "@/components/ui/keyboard";
import { Link } from "@/components/ui/link";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import useMediaQuery from "@/hooks/use-media-query";
import {
  useSessions,
  useCreateSession,
  useDeleteSession,
} from "@/hooks/use-opencode";
import type { Session } from "@opencode-ai/sdk";

function projectBasename(directory: string): string {
  const trimmed = directory.replace(/\/+$/g, "");
  const last = trimmed.split("/").pop();
  return last || directory;
}

function groupSessionsByDirectory(
  sessions: Session[],
): { dir: string; sessions: Session[] }[] {
  const byDir = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.parentID) continue;
    const d = s.directory || "(no directory)";
    const list = byDir.get(d) ?? [];
    list.push(s);
    byDir.set(d, list);
  }
  for (const list of byDir.values()) {
    list.sort(
      (a, b) =>
        (b.time?.updated ?? b.time?.created ?? 0) -
        (a.time?.updated ?? a.time?.created ?? 0),
    );
  }
  const arr = Array.from(byDir.entries()).map(([dir, ss]) => ({
    dir,
    sessions: ss,
  }));
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
  const deleteSession = useDeleteSession();

  const sessions: Session[] = sessionsData ?? [];

  const handleNewSession = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const newSession = await createSession();
      await mutate();
      navigate({ to: "/session/$id", params: { id: newSession.id } });
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      setCreating(false);
    }
  }, [creating, createSession, mutate, navigate]);

  async function handleDeleteSession(sessionId: string) {
    try {
      await deleteSession(sessionId);
      await mutate();
    } catch (err) {
      console.error("Failed to delete session:", err);
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
              onDeleteSession={handleDeleteSession}
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
        <div className="text-sm text-muted-fg">
          Press{" "}
          <Keyboard className="inline-flex px-1.5 py-0.5 rounded bg-secondary text-secondary-fg text-xs font-mono">
            Shift + Enter
          </Keyboard>{" "}
          to start a new session
        </div>
      </div>
    </div>
  );
}

interface ProjectsListMobileProps {
  sessions: Session[];
  onDeleteSession: (id: string) => void;
}

function ProjectsListMobile({
  sessions,
  onDeleteSession,
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
            isExpanded={isExpanded}
            onToggle={() => toggle(group.dir)}
            onDeleteSession={onDeleteSession}
          />
        );
      })}
    </ul>
  );
}

interface ProjectGroupMobileProps {
  directory: string;
  sessions: Session[];
  isExpanded: boolean;
  onToggle: () => void;
  onDeleteSession: (id: string) => void;
}

function ProjectGroupMobile({
  directory,
  sessions,
  isExpanded,
  onToggle,
  onDeleteSession,
}: ProjectGroupMobileProps) {
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    if (!isExpanded) setLimit(5);
  }, [isExpanded]);

  const visible = isExpanded ? sessions.slice(0, limit) : [];
  const remaining = sessions.length - visible.length;

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
        <span className="text-sm font-medium truncate flex-1 text-left">
          {projectBasename(directory)}
        </span>
        <span className="text-xs text-muted-fg shrink-0">
          {sessions.length}
        </span>
      </button>
      {visible.map((session) => (
        <div
          key={session.id}
          className="group flex items-center justify-between pl-6 rounded hover:bg-secondary/50 transition-colors"
        >
          <Link
            href={`/session/${session.id}`}
            className="flex-1 py-2 px-3 text-sm truncate"
          >
            {truncateTitle(
              session.title || `Session ${session.id.slice(0, 8)}`,
            )}
          </Link>
          <Menu>
            <MenuTrigger className="p-2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
              <EllipsisHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuContent popover={{ offset: 0, placement: "bottom end" }}>
              <MenuItem
                intent="danger"
                onAction={() => onDeleteSession(session.id)}
              >
                <TrashIcon />
                Delete Session
              </MenuItem>
            </MenuContent>
          </Menu>
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
    </li>
  );
}
