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
  // Session-id prefix queries (`ses_...`) bypass the 300-session cap
  // applied to the Recent list. Without this, pasting a known session
  // ID never matched if that session was outside the 300 most-recent
  // ones - the user's verbatim bug report (#69 in AI_TODO.md):
  // 'i paste ses_229d7083fffem6lkaEj69adZ7H and my match is the
  // session with that session id'. Exact / prefix match on session.id
  // is a precise filter; even at 10k+ sessions the work stays bounded.
  const trimmedQuery = query.trim();
  const isIdQuery = trimmedQuery.toLowerCase().startsWith("ses_");
  const recentSessions = useMemo(() => {
    const sorted = [...sessions]
      .filter((s) => !pinnedIds.has(s.id))
      .sort((a, b) => {
        const ta = sessionActivityTime(a) ?? 0;
        const tb = sessionActivityTime(b) ?? 0;
        return tb - ta;
      });
    return isIdQuery ? sorted : sorted.slice(0, 300);
  }, [sessions, pinnedIds, isIdQuery]);

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

  // Rank sessions by query relevance when the user is typing. Empty
  // query keeps the natural Pinned/Recent ordering. With a query, items
  // are sorted by score desc so an exact title hit beats a fuzzy hit.
  // Items that fail to score (no match) are dropped from rendering -
  // react-aria's own filter still runs as a second-pass safety net but
  // our custom scorer is the primary filter when a query is present.
  const rankSessions = (
    list: Session[],
  ): Array<{ session: Session; match: MatchResult }> => {
    const trimmed = query.trim();
    const out: Array<{ session: Session; match: MatchResult }> = [];
    const idQuery = trimmed.toLowerCase().startsWith("ses_")
      ? trimmed.toLowerCase()
      : null;
    for (const s of list) {
      const title = s.title || `Session ${s.id.slice(0, 8)}`;
      const project = projectLabelForSession(s);
      const titleMatch = scoreItem(title, project, trimmed);
      const idIndex = idQuery === null ? -1 : s.id.toLowerCase().indexOf(idQuery);
      const idMatch =
        idIndex >= 0
          ? {
              score: (idIndex === 0 ? 10_000 : 9_000) + idQuery!.length,
              titleRanges: [] as Array<[number, number]>,
              projectRanges: [] as Array<[number, number]>,
            }
          : null;
      const m = idMatch ?? titleMatch;
      if (m) out.push({ session: s, match: m });
    }
    if (trimmed) {
      out.sort((a, b) => b.match.score - a.match.score);
    }
    return out;
  };

  const rankedPinned = useMemo(
    () => rankSessions(pinnedSessions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinnedSessions, query, baseDirs.join("|"), homeDir],
  );
  const rankedRecent = useMemo(
    () => rankSessions(recentSessions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recentSessions, query, baseDirs.join("|"), homeDir],
  );

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
        {rankedPinned.length > 0 && (
          <CommandMenuSection label="Pinned">
            {rankedPinned.map(({ session, match }) =>
              renderSessionItem(session, true, match),
            )}
          </CommandMenuSection>
        )}

        {rankedRecent.length > 0 && (
          <CommandMenuSection label={rankedPinned.length > 0 ? "Recent" : "Sessions"}>
            {rankedRecent.map(({ session, match }) =>
              renderSessionItem(session, false, match),
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
