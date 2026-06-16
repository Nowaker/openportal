import { useState, useEffect, useMemo, useRef } from "react";
import { useCmdStore } from "@/stores/cmd-store";
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
  useAllSessions,
  useCreateSession,
  useInstances,
  usePortalConfig,
} from "@/hooks/use-opencode";
import { usePinnedSessions } from "@/hooks/use-pinned-sessions";
import { useInstanceStore } from "@/stores/instance-store";
import { resolveProjectPath } from "@/lib/project-path";
import { HighlightedText, scoreItem, type MatchResult } from "@/lib/fuzzy-rank";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import { IconGridPlus } from "@/components/icons/grid-plus-icon";
import IconBox from "@/components/icons/box-icon";
import { IconThemeDark } from "@/components/icons/theme-dark-icon";
import { IconThemeLight } from "@/components/icons/theme-light-icon";
import { IconThemeSystem } from "@/components/icons/theme-system-icon";
import { IconManageInstances } from "@/components/icons/manage-instances-icon";
import {
  ArrowTurnDownRightIcon,
  ChatBubbleLeftIcon,
  ServerIcon,
} from "@heroicons/react/24/solid";
import { useTheme } from "@/providers/theme-provider";
import { toast } from "@/components/ui/toast";
import type { Session } from "@opencode-ai/sdk";
import { useDateFormatStore } from "@/stores/date-format-store";
import { formatAbsoluteAndRelative, formatMessageTime } from "@/lib/format-time";

function sessionActivityTime(session: Session): number | undefined {
  const time = session.time as { created?: number; updated?: number } | undefined;
  return time?.updated ?? time?.created;
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

function hrefWithCurrentSearch(
  pathname: string,
  patch?: Record<string, string | null | undefined>,
): string {
  if (typeof window === "undefined") return pathname;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value == null) params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

// Ctrl+K searches the full in-memory session set but renders only the top
// N for performance - the palette is a quick-jump surface, not a browser.
const DISPLAY_LIMIT = 50;

export default function Cmd() {
  const isOpen = useCmdStore((s) => s.isOpen);
  const setIsOpen = useCmdStore((s) => s.setOpen);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const lastQueryRef = useRef("");
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams({ strict: false });
  const { data: sessionsData, mutate } = useAllSessions();
  const { data: instancesData } = useInstances();
  const { data: portalConfig } = usePortalConfig();
  const { data: pinnedData } = usePinnedSessions();
  const createSession = useCreateSession();
  const { setTheme } = useTheme();
  const currentInstance = useInstanceStore((s) => s.instance);
  const dateFormat = useDateFormatStore((s) => s.format);

  const sessions: Session[] = sessionsData ?? [];
  const instances: InstanceData[] = instancesData?.instances ?? [];
  const currentSessionId = params.id as string | undefined;

  // Ctrl+K is a single "Sessions" list, not split Pinned/Recent sections.
  // Pins influence sort order only (pinned-first, then by recent activity).
  const pinnedIds = useMemo(
    () => new Set(pinnedData?.sessions ?? []),
    [pinnedData?.sessions],
  );

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

  // Global search scope: every session whose directory is under a
  // configured workspace baseDir. Sessions outside an open workspace are
  // excluded; with no baseDirs configured we fall back to all sessions.
  const workspaceSessions = useMemo(() => {
    if (baseDirs.length === 0) return sessions;
    return sessions.filter((s) => {
      const dir = (s as { directory?: string }).directory;
      if (!dir) return false;
      return baseDirs.some((b) => {
        const base = b.path.replace(/\/+$/, "");
        return dir === base || dir.startsWith(base + "/");
      });
    });
  }, [sessions, baseDirs]);

  // One ranked "Sessions" list. Sort tiers (highest first), encoding the
  // user's spec "full string matches > fuzzy + pinned":
  //   0 full+pinned, 1 full+non-pinned, 2 fuzzy+pinned, 3 fuzzy+non-pinned,
  //   4 id-only+pinned, 5 id-only+non-pinned.
  // "full" = the query is a contiguous case-insensitive substring of the
  // title or project label; "fuzzy" = scoreItem matched but not contiguous.
  // ses_ queries match on session id (tier -1, ranks top). A bare fragment
  // that hits neither title nor project falls back to a session-id substring
  // match (tiers 4/5) so "17641" finds ses_176410872... the same way a title
  // fragment does, without ever displacing a real title/project hit. Empty
  // query: pinned then non-pinned, both by recent activity desc. Both states
  // render at most DISPLAY_LIMIT rows.
  const ranked = useMemo((): Array<{
    session: Session;
    match: MatchResult;
  }> => {
    const trimmed = query.trim();
    const q = trimmed.toLowerCase();
    const idQuery = q.startsWith("ses_") ? q : null;
    const emptyMatch: MatchResult = {
      score: 0,
      titleRanges: [],
      projectRanges: [],
    };

    if (!trimmed) {
      const sorted = [...workspaceSessions].sort((a, b) => {
        const ap = pinnedIds.has(a.id);
        const bp = pinnedIds.has(b.id);
        if (ap !== bp) return ap ? -1 : 1;
        return (sessionActivityTime(b) ?? 0) - (sessionActivityTime(a) ?? 0);
      });
      return sorted.slice(0, DISPLAY_LIMIT).map((session) => ({
        session,
        match: emptyMatch,
      }));
    }

    const out: Array<{
      session: Session;
      match: MatchResult;
      bucket: number;
    }> = [];
    for (const s of workspaceSessions) {
      const title = s.title || `Session ${s.id.slice(0, 8)}`;
      const project = projectLabelForSession(s);
      const pinned = pinnedIds.has(s.id);

      if (idQuery) {
        const idx = s.id.toLowerCase().indexOf(idQuery);
        if (idx < 0) continue;
        out.push({
          session: s,
          match: {
            score: (idx === 0 ? 10_000 : 9_000) + idQuery.length,
            titleRanges: [],
            projectRanges: [],
          },
          bucket: -1,
        });
        continue;
      }

      const m = scoreItem(title, project, trimmed);
      if (m) {
        const isFull =
          title.toLowerCase().includes(q) || project.toLowerCase().includes(q);
        const bucket = isFull ? (pinned ? 0 : 1) : pinned ? 2 : 3;
        out.push({ session: s, match: m, bucket });
        continue;
      }
      const idIdx = s.id.toLowerCase().indexOf(q);
      if (idIdx < 0) continue;
      out.push({
        session: s,
        match: { score: 1_000 - idIdx, titleRanges: [], projectRanges: [] },
        bucket: pinned ? 4 : 5,
      });
    }

    out.sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      return (
        (sessionActivityTime(b.session) ?? 0) -
        (sessionActivityTime(a.session) ?? 0)
      );
    });

    return out
      .slice(0, DISPLAY_LIMIT)
      .map(({ session, match }) => ({ session, match }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSessions, query, pinnedIds, baseDirs, homeDir]);

  const renderSessionItem = (
    session: Session,
    isPinned: boolean,
    match: MatchResult,
  ) => {
    const title = session.title || `Session ${session.id.slice(0, 8)}`;
    const projectLabel = projectLabelForSession(session);
    const textValue = [title, projectLabel, session.id].filter(Boolean).join(" ");
    const isCurrent = session.id === currentSessionId;
    const activityAt = sessionActivityTime(session);
    const timestamp = activityAt ? formatMessageTime(activityAt, dateFormat) : "";
    const timestampTitle = formatAbsoluteAndRelative(activityAt, dateFormat);
    return (
      <CommandMenuItem
        key={session.id}
        textValue={textValue}
        href={
          isCurrent
            ? undefined
            : hrefWithCurrentSearch(`/session/${session.id}`, { focus: "composer" })
        }
        onAction={() => setIsOpen(false)}
        isDisabled={isCurrent}
      >
        {isPinned ? (
          <StarSolidIcon className="size-4 text-amber-400" />
        ) : (session as { parentID?: string }).parentID ? (
          <ArrowTurnDownRightIcon
            className="size-4 text-violet-500"
            aria-label="Subsession (spawned by a parent session)"
          />
        ) : (
          <ChatBubbleLeftIcon className="size-4" />
        )}
        <CommandMenuLabel className="col-start-2 col-span-4 min-w-0 w-full">
          <div className="grid min-w-0 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">
                <HighlightedText text={title} ranges={match.titleRanges} />
              </span>
              {projectLabel && (
                <span className="text-xs text-muted-fg/70 shrink-0 font-mono">
                  <HighlightedText
                    text={projectLabel}
                    ranges={match.projectRanges}
                  />
                </span>
              )}
              {isCurrent && (
                <span className="text-[10px] uppercase tracking-wide text-primary shrink-0">
                  current
                </span>
              )}
            </span>
            {timestamp && (
              <span
                className="shrink-0 justify-self-end whitespace-nowrap text-xs tabular-nums text-muted-fg/70"
                title={timestampTitle}
              >
                {timestamp}
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

  // Permalink bridge: the palette's open state is mirrored into the URL
  // fragment `#search` so the "Open session" trigger can be a real link
  // (right-click / open-in-new-tab / Ctrl+click) and a fresh load carrying
  // `#search` opens the palette. replaceState (not push) keeps this
  // frequently-toggled quick-switcher out of the history stack.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setIsOpen(window.location.hash === "#search");
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [setIsOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cur = window.location.hash;
    // The URL fragment holds at most one overlay id; never stomp a hash
    // owned by a different overlay (e.g. #open-directory) when closing.
    if (isOpen ? cur === "#search" : cur !== "#search") return;
    const url = new URL(window.location.href);
    url.hash = isOpen ? "#search" : "";
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [isOpen]);

  async function handleNewSession() {
    setCreating(true);
    setIsOpen(false);
    try {
      const newSession = await createSession();
      await mutate();
      toast.success("Session created");
      navigate({
        to: "/session/$id",
        params: { id: newSession.id },
        search: { focus: "composer" },
      });
    } catch (err) {
      console.error("Failed to create session:", err);
      toast.error("Failed to create session");
    } finally {
      setCreating(false);
    }
  }

  function handleOpenChange(open: boolean) {
    if (open && query === "" && lastQueryRef.current !== "") {
      setQuery(lastQueryRef.current);
    }
    setIsOpen(open);
  }

  function handleInputChange(value: string) {
    setQuery(value);
    if (value !== "") {
      lastQueryRef.current = value;
    }
  }

  function handleThemeChange(theme: "light" | "dark" | "system") {
    setTheme(theme);
    setIsOpen(false);
  }

  function instanceHref(instance: InstanceData): string | undefined {
    if (!instance.webPort) return undefined;
    const host =
      instance.hostname === "0.0.0.0"
        ? window.location.hostname
        : instance.hostname;
    return `${window.location.protocol}//${host}:${instance.webPort}/`;
  }

  return (
    <CommandMenu
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      inputValue={query}
      onInputChange={handleInputChange}
      shortcut="k"
      size="wide"
      isBlurred
    >
      <CommandMenuSearch placeholder="Jump to session, action, or theme..." />
      <CommandMenuList>
        {ranked.length > 0 && (
          <CommandMenuSection label="Sessions">
            {ranked.map(({ session, match }) =>
              renderSessionItem(session, pinnedIds.has(session.id), match),
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
            href={hrefWithCurrentSearch("/instances")}
            onAction={() => setIsOpen(false)}
          >
            <IconManageInstances className="size-4 mr-2" />
            <CommandMenuLabel>Other Portals</CommandMenuLabel>
          </CommandMenuItem>
          <CommandMenuItem
            textValue="Servers"
            href={hrefWithCurrentSearch("/servers")}
            onAction={() => setIsOpen(false)}
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
                href={instanceHref(instance)}
                target="_blank"
                rel="noopener noreferrer"
                onAction={() => {
                  if (!instance.webPort) toast.error(`No web port registered for ${instance.name}`);
                  setIsOpen(false);
                }}
                isDisabled={currentInstance?.id === instance.id || !instance.webPort}
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
