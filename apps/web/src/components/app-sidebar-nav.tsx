import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "@tanstack/react-router";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathRoundedSquareIcon,
  ArrowTopRightOnSquareIcon,
  BellIcon,
  BoltIcon,
  BoltSlashIcon,
  CheckIcon,
  CodeBracketIcon,
  EllipsisVerticalIcon,
  FolderOpenIcon,
  InformationCircleIcon,
  PencilSquareIcon,
  QuestionMarkCircleIcon,
  SparklesIcon,
  StarIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  ExportSessionModal,
  SessionInfoModal,
} from "@/components/session-info-modal";
import { LongOpDialog } from "@/components/long-op-dialog";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { SessionContextDial } from "@/components/session-context-dial";
import { templateIconFor } from "@/lib/template-icons";
import { McpInfoModal } from "@/components/mcp-info-modal";
import { PluginInfoModal } from "@/components/plugin-info-modal";
import { useHashOpen, useHashValue } from "@/hooks/use-hash-open";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useElementWidth } from "@/hooks/use-element-width";
import { toast } from "@/components/ui/toast";
import {
  effectiveTitle,
  isEffectivelyArchived,
  type SessionWithOverlay,
} from "@/lib/session-overlay";
import { useMutationErrorStore } from "@/stores/mutation-errors-store";
import { MutationErrorIndicator } from "@/components/mutation-error-indicator";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DirectoryPicker } from "@/components/directory-picker/directory-picker";
import { mutate as globalSWRMutate } from "swr";
import {
  logSystemMessage,
  useSystemMessagesStore,
} from "@/stores/system-messages-store";
import { useInstanceStore } from "@/stores/instance-store";
import { useTitleBarActionsStore } from "@/stores/title-bar-actions-store";
import { useVscodeOpener } from "@/components/vscode-link";
import useSWR from "swr";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import { useModelStore } from "@/stores/model-store";
import {
  useToolsStore,
  resolveToolsFromState,
} from "@/stores/tools-store";
import { mutateSessionMessages } from "@/hooks/use-session-messages";
import {
  useSessions,
  useSessionStatus,
  useQuestions,
  usePermissions,
  useConfig,
} from "@/hooks/use-opencode";
import { useLastViewed } from "@/hooks/use-last-viewed";
import { useSessionErrorStore } from "@/stores/session-error-store";
import {
  usePinnedSessions,
  useTogglePinnedSession,
  useReorderPinnedSessions,
} from "@/hooks/use-pinned-sessions";
import { useMcpStatus, useToggleMcp } from "@/hooks/use-mcp";
import { useLspStatus } from "@/hooks/use-lsp";
import { useSidebar } from "@/components/ui/sidebar";
import { useSidebarExpandStore } from "@/stores/sidebar-expand-store";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";
import useMediaQuery from "@/hooks/use-media-query";
import {
  sessionHasDraft,
  sessionHasNewContent,
  SessionStatusDot,
  DraftIndicator,
} from "@/lib/session-indicators";
import {
  clearPendingSubmission,
  recordFailedAttempt,
  recordPendingSubmission,
} from "@/lib/pending-prompts";
import { cascadeIdsToAncestors } from "@/lib/project-path";
import type { Session } from "@opencode-ai/sdk";

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function buildOpenCodeWebSessionHref(
  instance: {
    hostname?: string;
    protocol?: "http" | "https";
    port: number;
    webEndpoint?: string;
  } | null,
  sessionId: string | undefined,
  directory: string | null | undefined,
): string | null {
  if (!instance || !sessionId) return null;
  const fallbackHost =
    instance.hostname && instance.hostname !== "0.0.0.0"
      ? instance.hostname
      : typeof window !== "undefined"
        ? window.location.hostname
        : "127.0.0.1";
  const base =
    instance.webEndpoint ||
    `${instance.protocol ?? "http"}://${fallbackHost}:${instance.port}`;
  try {
    const url = new URL(base);
    const prefix = url.pathname.replace(/\/+$/, "");
    const dirSlug = base64UrlEncode(directory || "x");
    url.pathname = `${prefix}/${dirSlug}/session/${encodeURIComponent(sessionId)}`;
    return url.toString();
  } catch {
    return null;
  }
}

// Take the deepest path component and use it as a short project label.
// session.directory can be absolute ('/home/u/projekty/nowaker/blah') or
// even a single-segment short name; either way the basename is what we
// surface in the topbar + browser tab.
async function compactSessionWithAudit(
  port: number,
  sessionId: string,
  providerID: string,
  modelID: string,
  projectDirectory: string | null,
): Promise<void> {
  toast.info("Compacting session...");
  try {
    const r = await fetch(
      `/api/opencode/${port}/session/${encodeURIComponent(sessionId)}/compact`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID, modelID }),
      },
    );
    if (r.ok) {
      toast.success("Session compacted.");
      logSystemMessage(
        "session",
        "success",
        "Session compacted",
        `Compacted with ${providerID}/${modelID}`,
        projectDirectory,
      );
      return;
    }
    const body = (await r.json().catch(() => null)) as
      | { error?: string; body?: { message?: string } }
      | null;
    const msg =
      body?.body?.message ??
      body?.error ??
      `Compaction failed (HTTP ${r.status}).`;
    toast.error(msg);
    logSystemMessage(
      "session",
      "error",
      "Compaction failed",
      msg,
      projectDirectory,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Compaction request failed.";
    toast.error(msg);
    logSystemMessage(
      "session",
      "error",
      "Compaction request errored",
      msg,
      projectDirectory,
    );
  }
}

function projectLabelFromDirectory(directory?: string): string | null {
  if (!directory) return null;
  const parts = directory.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

function hrefWithCurrentSearch(
  pathname: string,
  patch?: Record<string, string | null | undefined>,
  hash?: string,
): string {
  if (typeof window === "undefined") return `${pathname}${hash ? `#${hash}` : ""}`;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value == null) params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

interface AppSidebarNavProps {
  bannerSlot?: React.ReactNode;
}

export function AppSidebarNav({ bannerSlot }: AppSidebarNavProps = {}) {
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port ?? 0;
  const titleBarPlacements = useTitleBarActionsStore((s) => s.placements);
  const { open: openInVscode, modalElement: vscodeModal } = useVscodeOpener();
  const instanceId = instance?.id ?? null;
  const resolveModel = useModelStore((s) => s.resolveModel);
  const { setIsOpenOnMobile } = useSidebar();
  const { pageTitle } = useBreadcrumb();
  const navigate = useNavigate();
  const expandKey = useSidebarExpandStore((s) => s.expand);
  const { data: sessionsData, mutate: mutateSessions } = useSessions();
  // Subscribe to the raw store slices and derive the resolved list via
  // useMemo. Calling s.enabledTools() inside the Zustand selector returns
  // a fresh array on every render and triggers React 18 error #185
  // (infinite update loop) because Zustand sees a new identity each time.
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const burgerHiddenIds = useToolsStore((s) => s.burgerHiddenIds);
  const outsideBurgerIds = useToolsStore((s) => s.outsideBurgerIds);
  const iconOverrides = useToolsStore((s) => s.iconOverrides);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);
  const resolvedTools = useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        burgerHiddenIds,
        outsideBurgerIds,
        iconOverrides,
        systemOverrides,
        customTools,
        projectInitOrder,
        slashCommandIds,
      }),
    [
      disabledIds,
      burgerHiddenIds,
      outsideBurgerIds,
      iconOverrides,
      systemOverrides,
      customTools,
      projectInitOrder,
      slashCommandIds,
    ],
  );
  const enabledTools = useMemo(
    () => resolvedTools.filter((tool) => tool.enabled),
    [resolvedTools],
  );
  const outsideTools = useMemo(
    () =>
      resolvedTools.filter(
        (tool) => tool.isOutsideBurger && !tool.isDisabled,
      ),
    [resolvedTools],
  );

  const [runningToolId, setRunningToolId] = useState<string | null>(null);
  const [showSessionInfo, setShowSessionInfo] = useHashOpen("info");
  const [showExportSession, setShowExportSession] = useHashOpen("export");
  const [showCleanDialog, setShowCleanDialog] = useHashOpen("clean");
  const [showStuckFixDialog, setShowStuckFixDialog] = useHashOpen("stuck-fix");
  const [mcpInfoName, setMcpInfoName] = useHashValue("mcp");
  const [pluginInfoSpec, setPluginInfoSpec] = useHashValue("plugin");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [movePending, setMovePending] = useState<{
    targetPath: string;
    dryRunStdout: string;
  } | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveLiveRunnerPrompt, setMoveLiveRunnerPrompt] = useState<{
    targetPath: string;
    reason: string;
    liveSessionIds: string[];
  } | null>(null);
  // Hamburger menu open state. Plain React state - NOT hash-tracked.
  // Two reasons:
  //   1. Transient toggle: opening/closing the menu is not shareable
  //      state, doesn't belong in the URL.
  //   2. Permalink race: when the menu is open with `#menu` and the
  //      user picks "Session Info", the MenuItem onAction first
  //      pushes `#info`, then React Aria auto-closes the menu which
  //      pushes `""`, overwriting the `#info` hash. The modal opens
  //      in React state but the URL has no permalink.
  //   3. Back-navigation: hash-tracking the menu means a flow like
  //      burger -> Prompt History (navigates away) -> back button
  //      re-opens the burger (because the prior history entry had
  //      `#menu`), which is exactly the wrong behavior - the user
  //      expects to return to the prior session view, not the menu.
  // Android hardware-back closing the menu is now handled implicitly
  // by React Aria's Menu component on Escape / outside-tap.
  const [menuOpen, setMenuOpen] = useState(false);

  const sessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const newSessionMatch = useMatch({
    from: "/_app/session/new",
    shouldThrow: false,
  });
  const sessionId = sessionMatch?.params?.id;
  const sessions: Session[] = sessionsData ?? [];
  const currentSession = sessions.find((s) => s.id === sessionId);
  const openCodeWebHref = buildOpenCodeWebSessionHref(
    instance,
    sessionId,
    currentSession?.directory,
  );
  // New-session route: the topbar should mirror the actual-session layout
  // ('{projectLabel}: New session') instead of falling through to the
  // instance name ('opencode'), which gives the user no signal about
  // which project they're about to start a session in. We reuse the
  // exact same JSX rendering by reading the directory off either the
  // URL search params or the virtual-session-store (which captures the
  // last 'Open directory' click) and synthesizing the labels the same
  // way an active session would surface them.
  const newSessionDirFromUrl =
    typeof newSessionMatch?.search?.directory === "string"
      ? newSessionMatch.search.directory
      : null;
  const storeDirForNewSession = useVirtualSessionStore((s) => s.directory);
  const newSessionDirectory = newSessionMatch
    ? newSessionDirFromUrl || storeDirForNewSession || null
    : null;
  const sessionTitle =
    effectiveTitle(currentSession as SessionWithOverlay | null | undefined) ??
    (newSessionDirectory ? "New session" : null);
  const systemMessagesUnread = useSystemMessagesStore((s) => s.unreadCount);
  const directoryForLabel =
    currentSession?.directory ?? newSessionDirectory ?? undefined;
  const projectLabel = projectLabelFromDirectory(directoryForLabel);
  // Subagent sessions: opencode sets parentID on child sessions and appends
  // a `(@<agent> subagent)` marker to the title. The marker carries the
  // AGENT TYPE (e.g. "general"); the meaningful per-session label is the
  // text BEFORE that marker (the actual subtask description). Show the
  // task description in the topbar; the agent type is identical across
  // all subsessions of a project and provides no per-session signal.
  const parentSession = currentSession?.parentID
    ? sessions.find((s) => s.id === currentSession.parentID)
    : null;
  const subagentMatch = sessionTitle?.match(/^(.*)\s+\(@([^)\s]+)\s+subagent\)$/);
  const subagentTaskTitle = subagentMatch
    ? subagentMatch[1].trim()
    : null;
  const isSubagent = Boolean(
    currentSession?.parentID && (subagentTaskTitle || sessionTitle),
  );

  // Browser tab title: 'OP: <sessionTitle>' on a session route, plain
  // 'OpenPortal' elsewhere. Short 'OP:' prefix keeps the title legible in
  // narrow tab strips while still clearly signalling which app the tab is.
  // Restored on unmount so other pages don't inherit a stale session label.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = sessionTitle ? `OP: ${sessionTitle}` : "OpenPortal";
    return () => {
      document.title = previous;
    };
  }, [sessionTitle]);

  const runTool = async (toolId: string, prompt: string, label: string) => {
    if (!sessionId || !port) {
      toast.error("Please open a session first");
      return;
    }
    setRunningToolId(toolId);
    const selectedModel = resolveModel(sessionId, instanceId);
    const pendingLocalId = recordPendingSubmission({
      sessionId,
      port,
      text: prompt,
      model: selectedModel ?? undefined,
      attachmentsCount: 0,
      kind: "prompt",
    });
    try {
      const response = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: prompt, model: selectedModel }),
        },
      );
      if (!response.ok) {
        recordFailedAttempt(pendingLocalId, `HTTP ${response.status}`);
        throw new Error("Failed to send request");
      }
      clearPendingSubmission(pendingLocalId);
      mutateSessionMessages(port, sessionId);
      mutateSessions();
      toast.success(`${label} request sent`);
    } catch (err) {
      recordFailedAttempt(
        pendingLocalId,
        err instanceof Error ? err.message : "network error",
      );
      console.error(`Failed to run ${label}:`, err);
      toast.error(`Failed to send ${label} request`);
    } finally {
      setRunningToolId(null);
    }
  };

  const isBusy = runningToolId !== null;
  const canRun = Boolean(sessionId);

  const { isMobile } = useMediaQuery();
  const { data: pinnedData } = usePinnedSessions();
  const togglePinTopbar = useTogglePinnedSession();
  const isPinnedHere = sessionId
    ? (pinnedData?.sessions.includes(sessionId) ?? false)
    : false;
  const handleTogglePin = () => {
    if (!sessionId) return;
    void togglePinTopbar(sessionId, isPinnedHere ? "unpin" : "pin");
  };

  // Resolver, not direct field read - honors pending overlay before opencode catches up.
  const isArchived = isEffectivelyArchived(
    currentSession as SessionWithOverlay | null | undefined,
  );

  const callMoveLocal = async (
    targetPath: string,
    options: { dryRun?: boolean; abort?: boolean } = {},
  ) => {
    if (!port || !sessionId) {
      throw new Error("no session selected");
    }
    const r = await fetch(
      `/api/opencode/${port}/session/${encodeURIComponent(sessionId)}/move-to-project`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetPath,
          dryRun: options.dryRun === true,
          abort: options.abort === true,
        }),
      },
    );
    const json = (await r.json().catch(() => null)) as {
      ok?: boolean;
      stdout?: string;
      stderr?: string;
      error?: string;
      liveRunner?: boolean;
      liveSessionIds?: string[];
    } | null;
    if (!r.ok || !json?.ok) {
      const err = new Error(
        json?.error ?? `move failed (HTTP ${r.status})`,
      ) as Error & {
        liveRunner?: boolean;
        liveSessionIds?: string[];
        stdout?: string;
      };
      err.liveRunner = json?.liveRunner === true;
      err.liveSessionIds = Array.isArray(json?.liveSessionIds)
        ? (json.liveSessionIds as string[])
        : [];
      err.stdout = json?.stdout ?? "";
      throw err;
    }
    return { stdout: json.stdout ?? "", stderr: json.stderr ?? "" };
  };

  const handleMoveTargetSelected = async (targetPath: string) => {
    setShowMovePicker(false);
    if (!port || !sessionId) return;
    setMoveBusy(true);
    try {
      const result = await callMoveLocal(targetPath, { dryRun: true });
      setMovePending({ targetPath, dryRunStdout: result.stdout });
    } catch (err) {
      const e = err as Error & {
        liveRunner?: boolean;
        liveSessionIds?: string[];
      };
      if (e.liveRunner) {
        setMoveLiveRunnerPrompt({
          targetPath,
          reason: e.message,
          liveSessionIds: e.liveSessionIds ?? [],
        });
      } else {
        toast.error(e.message);
      }
    } finally {
      setMoveBusy(false);
    }
  };

  const handleMoveConfirm = async () => {
    if (!movePending) return;
    setMoveBusy(true);
    try {
      await callMoveLocal(movePending.targetPath);
      toast.success("Session moved.");
      logSystemMessage(
        "session",
        "success",
        `Session moved to ${movePending.targetPath}`,
        undefined,
        currentSession?.directory ?? null,
      );
      setMovePending(null);
      await globalSWRMutate(
        (key) =>
          typeof key === "string" &&
          (key.includes("/sessions") ||
            key.endsWith(`/session/${sessionId}`)),
        undefined,
        { revalidate: true },
      );
    } catch (err) {
      const e = err as Error;
      toast.error(e.message);
      logSystemMessage(
        "session",
        "error",
        "Move-to-project failed",
        e.message,
        currentSession?.directory ?? null,
      );
    } finally {
      setMoveBusy(false);
    }
  };

  const handleMoveAbortAndProceed = async () => {
    if (!moveLiveRunnerPrompt) return;
    const targetPath = moveLiveRunnerPrompt.targetPath;
    setMoveLiveRunnerPrompt(null);
    setMoveBusy(true);
    try {
      const result = await callMoveLocal(targetPath, {
        dryRun: true,
        abort: true,
      });
      setMovePending({ targetPath, dryRunStdout: result.stdout });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "move failed");
    } finally {
      setMoveBusy(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!port || !sessionId) return;
    setArchiveBusy(true);
    try {
      const route = isArchived ? "unarchive" : "archive";
      const r = await fetch(
        `/api/opencode/${port}/session/${encodeURIComponent(sessionId)}/${route}`,
        { method: "POST" },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        const err =
          body?.error ?? `${isArchived ? "Unarchive" : "Archive"} failed (HTTP ${r.status}).`;
        toast.error(err);
        logSystemMessage(
          "session",
          "error",
          `${isArchived ? "Unarchive" : "Archive"} failed`,
          err,
          currentSession?.directory ?? null,
        );
        return;
      }
      toast.success(isArchived ? "Session unarchived." : "Session archived.");
      logSystemMessage(
        "session",
        "success",
        isArchived ? "Session unarchived" : "Session archived",
        undefined,
        currentSession?.directory ?? null,
      );
      await globalSWRMutate(
        (key) =>
          typeof key === "string" &&
          (key.includes("/sessions") || key.endsWith(`/session/${sessionId}`)),
        undefined,
        { revalidate: true },
      );
      setShowArchiveConfirm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Archive request failed.";
      toast.error(msg);
      logSystemMessage(
        "session",
        "error",
        `${isArchived ? "Unarchive" : "Archive"} request errored`,
        msg,
        currentSession?.directory ?? null,
      );
    } finally {
      setArchiveBusy(false);
    }
  };

  const { data: mcpStatus } = useMcpStatus();
  const toggleMcp = useToggleMcp();
  const mcpEntries = useMemo(
    () =>
      Object.entries(mcpStatus ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [mcpStatus],
  );
  const { data: lspStatus } = useLspStatus();
  const lspEntries = useMemo(
    () =>
      [...(lspStatus ?? [])].sort((a, b) =>
        (a.id || a.name).localeCompare(b.id || b.name),
      ),
    [lspStatus],
  );

  const { data: opencodeConfig } = useConfig();
  const pluginEntries = useMemo(() => {
    const raw = (opencodeConfig as { plugin?: unknown } | undefined)?.plugin;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is string => typeof s === "string")
      .map((spec) => {
        const isFile = spec.startsWith("file://") || spec.startsWith("/");
        const target = isFile ? spec.replace(/^file:\/\//, "") : spec;
        const label = isFile
          ? target.split("/").filter(Boolean).pop() || target
          : target.replace(/@[^@]*$/, "");
        const versionMatch = isFile ? null : target.match(/@([^@]*)$/);
        const version = versionMatch ? versionMatch[1] : undefined;
        return {
          spec,
          label,
          source: isFile ? ("local" as const) : ("npm" as const),
          version,
          target,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [opencodeConfig]);

  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset edit mode whenever the session changes (otherwise the draft
  // value from session A would be visible in session B's edit field).
  useEffect(() => {
    setEditingTitle(false);
    setDraftTitle("");
  }, [sessionId]);

  const startEditTitle = () => {
    setDraftTitle(sessionTitle ?? "");
    setEditingTitle(true);
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  };

  const cancelEditTitle = () => {
    setEditingTitle(false);
    setDraftTitle("");
  };

  const submitEditTitle = async () => {
    const trimmed = draftTitle.trim();
    if (!sessionId || !port) {
      cancelEditTitle();
      return;
    }
    if (!trimmed || trimmed === sessionTitle) {
      cancelEditTitle();
      return;
    }
    setEditingTitle(false);
    setDraftTitle("");
    useMutationErrorStore.getState().clearError(sessionId);
    const key = `/api/opencode/${port}/sessions`;
    await globalSWRMutate(
      key,
      (current: unknown) => {
        if (!Array.isArray(current)) return current;
        return current.map((s) =>
          s?.id === sessionId
            ? { ...s, _pendingTitle: { value: trimmed, setAt: Date.now() } }
            : s,
        );
      },
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/opencode/${port}/session/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void globalSWRMutate(key);
    } catch (e) {
      await globalSWRMutate(
        key,
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          return current.map((s) => {
            if (s?.id !== sessionId) return s;
            const copy = { ...s };
            delete copy._pendingTitle;
            return copy;
          });
        },
        { revalidate: false },
      );
      useMutationErrorStore.getState().setError(sessionId, {
        field: "title",
        message: `Failed to rename: ${e instanceof Error ? e.message : "unknown"}`,
        at: Date.now(),
      });
    }
  };

  const showPageTitle = !sessionId && !!pageTitle;

  const clusterRef = useRef<HTMLDivElement>(null);
  const clusterWidth = useElementWidth(clusterRef);

  return (
    <nav
      data-slot="sidebar-nav"
      className="isolate sticky top-0 z-40 flex flex-col shrink-0 border-b bg-bg text-fg min-h-[3.5rem]"
    >
      <div className="flex flex-1 min-w-0 flex-col">
        <div
          className="flex h-[3.5rem] items-center gap-x-2 px-4"
          style={
            clusterWidth > 0 ? { paddingRight: `${clusterWidth}px` } : undefined
          }
        >
          <span className="flex items-center gap-x-1 min-w-0 flex-1">
        <SidebarTrigger className="-ml-2 px-0 shrink-0" />
        {showPageTitle && (
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              } else {
                void navigate({ to: "/", search: (prev) => prev });
              }
            }}
            aria-label="Back"
            title="Back"
            className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        )}
        {editingTitle && sessionId ? (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <input
              ref={titleInputRef}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitEditTitle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEditTitle();
                }
              }}
              disabled={renameSaving}
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-0.5 text-sm font-medium text-fg outline-none focus:border-primary"
              aria-label="Session title"
            />
            <button
              type="button"
              onClick={() => void submitEditTitle()}
              disabled={renameSaving}
              aria-label="Save title"
              title="Save (Enter)"
              className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-40"
            >
              <CheckIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={cancelEditTitle}
              disabled={renameSaving}
              aria-label="Cancel rename"
              title="Cancel (Esc)"
              className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-40"
            >
              <XMarkIcon className="size-4" />
            </button>
          </span>
        ) : (
          <>
            <span className="min-w-0 overflow-x-auto whitespace-nowrap text-sm font-medium text-fg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sessionTitle ? (
                <>
                  {projectLabel && directoryForLabel && (
                    <button
                      type="button"
                      onClick={() => {
                        const dir = directoryForLabel;
                        if (!dir) return;
                        expandKey(dir);
                        setIsOpenOnMobile(true);
                        requestAnimationFrame(() => {
                          const el = document.querySelector(
                            `[data-project-dir="${CSS.escape(dir)}"]`,
                          );
                          el?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        });
                      }}
                      className="text-muted-fg hover:text-fg hover:underline underline-offset-2"
                      title={`Jump to ${projectLabel} in sidebar`}
                    >
                      {projectLabel}
                    </button>
                  )}
                  {projectLabel && directoryForLabel && (
                    <span className="text-muted-fg">: </span>
                  )}
                  {isSubagent ? (
                    <>
                      {parentSession?.title ? (
                        <a
                          href={`/session/${parentSession.id}`}
                          className="text-muted-fg hover:text-fg hover:underline underline-offset-2"
                          title={`Open parent session: ${parentSession.title}`}
                        >
                          {parentSession.title}
                        </a>
                      ) : (
                        <span className="text-muted-fg">
                          (parent session)
                        </span>
                      )}
                      <span className="text-muted-fg">: </span>
                      {subagentTaskTitle ?? sessionTitle}
                    </>
                  ) : (
                    sessionTitle
                  )}
                </>
              ) : showPageTitle ? (
                <span>{pageTitle}</span>
              ) : (
                <span className="text-muted-fg">
                  {instance?.name ?? "OpenPortal"}
                </span>
              )}
            </span>
            {sessionId && (
              <SessionStatusBadge
                sessionId={sessionId}
                archived={isArchived}
                className="shrink-0"
              />
            )}
            {sessionId && parentSession && (
              <SubagentJumpButtons
                childID={sessionId}
                port={port}
                parentSessionID={parentSession.id}
                parentTitle={parentSession.title ?? parentSession.id}
              />
            )}
            {!isMobile && sessionId && sessionTitle && (
              <button
                type="button"
                onClick={startEditTitle}
                aria-label="Rename session"
                title="Rename session"
                className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
              >
                <PencilSquareIcon className="size-4" />
              </button>
            )}
            {sessionId && (
              <MutationErrorIndicator
                sessionId={sessionId}
                className="shrink-0"
              />
            )}
            {sessionId && port && titleBarPlacements.compact === "both" && (
              <button
                type="button"
                onClick={() => {
                  const selectedModel = resolveModel(sessionId, instanceId);
                  void compactSessionWithAudit(
                    port,
                    sessionId,
                    selectedModel.providerID,
                    selectedModel.modelID,
                    currentSession?.directory ?? null,
                  );
                }}
                aria-label="Compact session"
                title="Compact session - summarise older history"
                data-test="portal-titlebar-compact"
                className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
              >
                <ArrowPathRoundedSquareIcon className="size-4" />
              </button>
            )}
            {sessionId && port && titleBarPlacements.export === "both" && (
              <a
                href={`/api/opencode/${port}/session/${encodeURIComponent(sessionId)}/export`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Export session as Markdown"
                title="Download full chat as Markdown"
                data-test="portal-titlebar-export"
                className="shrink-0 inline-flex items-center justify-center rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
              >
                <ArrowDownTrayIcon className="size-4" />
              </a>
            )}
          </>
        )}
          </span>
        </div>
        {bannerSlot}
      </div>
      <div
        ref={clusterRef}
        className="absolute top-0 right-0 flex h-[3.5rem] items-center gap-x-2 px-4"
      >
        <span className="flex items-center gap-x-2 shrink-0">
        {sessionId && (
          <SessionContextDial
            sessionId={sessionId}
            href={`${hrefWithCurrentSearch(`/session/${sessionId}`)}#info`}
            onClick={() => setShowSessionInfo(true)}
          />
        )}
        {!isMobile && sessionId && <PinTopbarButton sessionId={sessionId} />}
        {!isMobile &&
          sessionId &&
          outsideTools.map((tool) => {
            const Icon = templateIconFor(tool.iconId);
            return (
              <button
                key={tool.id}
                type="button"
                disabled={!canRun || isBusy}
                onClick={() => runTool(tool.id, tool.prompt, tool.name)}
                aria-label={tool.name}
                title={tool.name}
                data-test={`portal-titlebar-template-${tool.id}`}
                className="shrink-0 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg disabled:opacity-40"
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        <Menu isOpen={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger aria-label="Open menu">
            <Button intent="outline" size="sq-sm">
              <EllipsisVerticalIcon className="size-4" />
            </Button>
          </MenuTrigger>
          <MenuContent placement="bottom end" className="min-w-56">
            <MenuSection>
              <MenuItem
                href={hrefWithCurrentSearch(
                  "/prompts",
                  sessionId ? { focus: sessionId } : undefined,
                )}
              >
                <ArchiveBoxIcon className="size-4" data-slot="icon" />
                Prompt history
              </MenuItem>
              <MenuItem href={hrefWithCurrentSearch("/pinned")}>
                <StarIcon className="size-4" data-slot="icon" />
                Pinned messages
              </MenuItem>
              <MenuItem
                href={hrefWithCurrentSearch(
                  "/files",
                  currentSession?.directory
                    ? {
                        path: currentSession.directory,
                        project: currentSession.directory,
                      }
                    : undefined,
                )}
              >
                <FolderOpenIcon className="size-4" data-slot="icon" />
                File browser
              </MenuItem>
              <MenuItem
                onAction={() => {
                  const dir = currentSession?.directory ?? null;
                  const sid = currentSession?.id ?? null;
                  useSystemMessagesStore
                    .getState()
                    .openProjectFiltered(dir, sid);
                }}
                data-test="portal-hamburger-system-messages"
              >
                <BellIcon className="size-4" data-slot="icon" />
                <span>
                  System messages
                  {systemMessagesUnread > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-500/90 text-white text-[10px] font-semibold min-w-4 h-4 px-1 align-middle">
                      {systemMessagesUnread > 99 ? "99+" : systemMessagesUnread}
                    </span>
                  )}
                </span>
              </MenuItem>
            </MenuSection>
            {sessionId && <MenuSeparator />}
            {sessionId && (
                <MenuSection>
                  <MenuItem href={`${hrefWithCurrentSearch(`/session/${sessionId}`)}#info`}>
                    <InformationCircleIcon
                      className="size-4"
                      data-slot="icon"
                    />
                    Session info
                  </MenuItem>
                  <MenuItem href={`${hrefWithCurrentSearch(`/session/${sessionId}`)}#export`}>
                    <ArrowDownTrayIcon
                      className="size-4"
                      data-slot="icon"
                    />
                    Export session
                  </MenuItem>
                  {currentSession?.directory && (
                    <MenuItem
                      onAction={() => openInVscode(currentSession.directory)}
                      data-test="portal-hamburger-open-vscode"
                    >
                      <CodeBracketIcon
                        className="size-4"
                        data-slot="icon"
                      />
                      Open in VS Code
                    </MenuItem>
                  )}
                  <MenuItem
                    href={openCodeWebHref ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    isDisabled={!openCodeWebHref}
                    data-test="portal-hamburger-open-opencode-web"
                  >
                    <ArrowTopRightOnSquareIcon
                      className="size-4"
                      data-slot="icon"
                    />
                    Open in OpenCode Web
                  </MenuItem>
                  <MenuItem
                    onAction={() => {
                      if (!port || !sessionId) return;
                      const selectedModel = resolveModel(
                        sessionId,
                        instanceId,
                      );
                      void compactSessionWithAudit(
                        port,
                        sessionId,
                        selectedModel.providerID,
                        selectedModel.modelID,
                        currentSession?.directory ?? null,
                      );
                    }}
                  >
                    <ArrowPathRoundedSquareIcon
                      className="size-4"
                      data-slot="icon"
                    />
                    Compact session
                  </MenuItem>
                  <MenuItem
                    href={`${hrefWithCurrentSearch(`/session/${sessionId}`)}#clean`}
                    data-test="portal-hamburger-clean-session"
                  >
                    <SparklesIcon className="size-4" data-slot="icon" />
                    Clean session...
                  </MenuItem>
                  <MenuItem
                    href={`${hrefWithCurrentSearch(`/session/${sessionId}`)}#stuck-fix`}
                    data-test="portal-hamburger-stuck-fix"
                  >
                    <WrenchScrewdriverIcon
                      className="size-4"
                      data-slot="icon"
                    />
                    Fix stuck compaction...
                  </MenuItem>
                  <MenuItem
                    onAction={() => {
                      void handleArchiveToggle();
                    }}
                    data-test={`portal-hamburger-${isArchived ? "unarchive" : "archive"}`}
                  >
                    <ArchiveBoxIcon className="size-4" data-slot="icon" />
                    {isArchived ? "Unarchive session" : "Archive session"}
                  </MenuItem>
                  <MenuItem
                    onAction={() => setShowMovePicker(true)}
                    isDisabled={moveBusy}
                    data-test="portal-hamburger-move"
                  >
                    <FolderOpenIcon className="size-4" data-slot="icon" />
                    Move to project...
                  </MenuItem>
                  {isMobile && sessionTitle && (
                    <MenuItem onAction={startEditTitle}>
                      <PencilSquareIcon
                        className="size-4"
                        data-slot="icon"
                      />
                      Rename session
                    </MenuItem>
                  )}
                  {isMobile && (
                    <MenuItem onAction={handleTogglePin}>
                      {isPinnedHere ? (
                        <StarSolidIcon
                          className="size-4 text-amber-400"
                          data-slot="icon"
                        />
                      ) : (
                        <StarIcon className="size-4" data-slot="icon" />
                      )}
                      {isPinnedHere ? "Unpin session" : "Pin session"}
                    </MenuItem>
                  )}
                </MenuSection>
              )}
              {sessionId && enabledTools.length > 0 && <MenuSeparator />}
              {enabledTools.length > 0 && (
                <MenuSection label="Prompt templates">
                  {enabledTools.map((tool) => (
                    <MenuItem
                      key={tool.id}
                      isDisabled={!canRun || isBusy}
                      onAction={() => runTool(tool.id, tool.prompt, tool.name)}
                    >
                      {tool.name}
                    </MenuItem>
                  ))}
                </MenuSection>
              )}
              {mcpEntries.length > 0 &&
                (sessionId || enabledTools.length > 0) && <MenuSeparator />}
              {mcpEntries.length > 0 && (
                <MenuSection label="MCP servers">
                  {mcpEntries.map(([name, status]) => (
                    <MenuItem
                      key={name}
                      textValue={name}
                      onAction={() => setMcpInfoName(name)}
                    >
                      <McpRow
                        name={name}
                        kind={status.status}
                        onToggle={toggleMcp}
                        onOpenInfo={() => setMcpInfoName(name)}
                      />
                    </MenuItem>
                  ))}
                </MenuSection>
              )}
              {lspEntries.length > 0 &&
                (sessionId ||
                  enabledTools.length > 0 ||
                  mcpEntries.length > 0) && <MenuSeparator />}
              {lspEntries.length > 0 && (
                <MenuSection label="LSP servers">
                  {lspEntries.map((lsp) => {
                    const ok = lsp.status === "connected";
                    const label = lsp.name || lsp.id;
                    const tooltip = `${label} \u2014 ${lsp.status}\nroot: ${lsp.root}`;
                    return (
                      <MenuItem
                        key={lsp.id || lsp.name}
                        textValue={label}
                        // @ts-expect-error closeOnSelect honored at runtime by
                        // useMenuItem; not in public types.
                        closeOnSelect={false}
                      >
                        <div
                          className="flex w-full items-center gap-2 min-w-0"
                          title={tooltip}
                        >
                          <BoltIcon
                            className={`size-4 shrink-0 ${ok ? "text-muted-fg" : "text-muted-fg/40"}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {label}
                          </span>
                          <span
                            aria-hidden
                            className={`shrink-0 size-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
                          />
                        </div>
                      </MenuItem>
                    );
                  })}
                </MenuSection>
              )}
              {pluginEntries.length > 0 &&
                (sessionId ||
                  enabledTools.length > 0 ||
                  mcpEntries.length > 0 ||
                  lspEntries.length > 0) && <MenuSeparator />}
              {pluginEntries.length > 0 && (
                <MenuSection label="Plugins">
                  {pluginEntries.map((p) => (
                    <MenuItem
                      key={p.spec}
                      textValue={p.label}
                      href={hrefWithCurrentSearch(
                        typeof window === "undefined" ? "/" : window.location.pathname,
                        undefined,
                        `plugin:${encodeURIComponent(p.spec)}`,
                      )}
                    >
                      <div
                        className="flex w-full items-center gap-2 min-w-0"
                        title={`${p.label} \u2014 ${p.source}\n${p.target}`}
                      >
                        <BoltIcon className="size-4 shrink-0 text-muted-fg" />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {p.label}
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-fg">
                          {p.source}
                          {p.version ? ` ${p.version}` : ""}
                        </span>
                        <span
                          aria-label={`Plugin info: ${p.label}`}
                          title="Show plugin details"
                          className="shrink-0 inline-flex items-center justify-center size-5 rounded text-muted-fg hover:bg-muted hover:text-fg pointer-events-none"
                        >
                          <QuestionMarkCircleIcon className="size-4" />
                        </span>
                      </div>
                    </MenuItem>
                  ))}
                </MenuSection>
              )}
            </MenuContent>
          </Menu>
        </span>
      </div>
      {sessionId && (
        <SessionInfoModal
          isOpen={showSessionInfo}
          sessionId={sessionId}
          onOpenChange={setShowSessionInfo}
        />
      )}
      {sessionId && (
        <ExportSessionModal
          isOpen={showExportSession}
          sessionId={sessionId}
          onOpenChange={setShowExportSession}
        />
      )}
      {sessionId && port > 0 && (
        <LongOpDialog
          kind="clean"
          isOpen={showCleanDialog}
          onOpenChange={setShowCleanDialog}
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          port={port}
          directory={currentSession?.directory ?? null}
          onForkCreated={(forkId) => {
            setShowCleanDialog(false);
            logSystemMessage(
              "session",
              "success",
              "Session cleaned",
              `Forked + cleaned session ${sessionId}; new id ${forkId}`,
              currentSession?.directory ?? null,
            );
            startTransition(() => {
              void navigate({
                to: "/session/$id",
                params: { id: forkId },
                search: true,
              });
            });
          }}
        />
      )}
      {sessionId && port > 0 && (
        <LongOpDialog
          kind="stuck-fix"
          isOpen={showStuckFixDialog}
          onOpenChange={setShowStuckFixDialog}
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          port={port}
          directory={currentSession?.directory ?? null}
          onForkCreated={(forkId) => {
            setShowStuckFixDialog(false);
            logSystemMessage(
              "session",
              "success",
              "Stuck compaction recovered",
              `Recovered session ${sessionId}; new id ${forkId}`,
              currentSession?.directory ?? null,
            );
            startTransition(() => {
              void navigate({
                to: "/session/$id",
                params: { id: forkId },
                search: true,
              });
            });
          }}
        />
      )}
      <McpInfoModal
        isOpen={mcpInfoName !== null}
        mcpName={mcpInfoName}
        onOpenChange={(open) => {
          if (!open) setMcpInfoName(null);
        }}
      />
      <PluginInfoModal
        isOpen={pluginInfoSpec !== null}
        spec={pluginInfoSpec}
        onOpenChange={(open) => {
          if (!open) setPluginInfoSpec(null);
        }}
      />
      <ConfirmDialog
        isOpen={showArchiveConfirm}
        title={isArchived ? "Unarchive this session?" : "Archive this session?"}
        description={
          isArchived
            ? `"${sessionTitle ?? sessionId}" will return to the active sessions list.`
            : `"${sessionTitle ?? sessionId}" will be moved to the archived sessions list. Unarchive any time from the same menu.`
        }
        confirmLabel={isArchived ? "Unarchive" : "Archive"}
        tone="default"
        busy={archiveBusy}
        onConfirm={handleArchiveToggle}
        onClose={() => {
          if (!archiveBusy) setShowArchiveConfirm(false);
        }}
      />
      <DirectoryPicker
        isOpen={showMovePicker}
        onOpenChange={(open) => {
          if (!open) setShowMovePicker(false);
        }}
        onSelect={(path) => {
          void handleMoveTargetSelected(path);
        }}
        title="Move session to project"
        excludePath={currentSession?.directory ?? null}
      />
      <ConfirmDialog
        isOpen={movePending !== null}
        title={`Move "${sessionTitle ?? sessionId}"?`}
        description={
          movePending ? (
            <div className="space-y-2 text-sm text-muted-fg">
              <div>
                <span className="font-medium text-fg">Target:</span>{" "}
                <span className="break-all">{movePending.targetPath}</span>
              </div>
              <div>
                <div className="font-medium text-fg mb-1">Dry-run output:</div>
                <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-all bg-muted/30 border border-border/40 rounded p-2 text-fg">
                  {movePending.dryRunStdout}
                </pre>
              </div>
            </div>
          ) : (
            ""
          )
        }
        confirmLabel="Move"
        tone="default"
        busy={moveBusy}
        onConfirm={handleMoveConfirm}
        onClose={() => {
          if (!moveBusy) setMovePending(null);
        }}
      />
      <ConfirmDialog
        isOpen={moveLiveRunnerPrompt !== null}
        title="Session has a live runner"
        description={
          moveLiveRunnerPrompt ? (
            <div className="space-y-2 text-sm text-muted-fg">
              {moveLiveRunnerPrompt.liveSessionIds.length > 0 && (
                <div>
                  <div className="font-medium text-fg mb-1">
                    Live session(s):
                  </div>
                  <ul className="text-[11px] font-mono break-all space-y-0.5">
                    {moveLiveRunnerPrompt.liveSessionIds.map((sid) => (
                      <li key={sid}>{sid}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p>
                Abort the live runner(s) and move? Any stuck subagent sessions
                will be auto-skipped.
              </p>
              <div>
                <div className="font-medium text-fg mb-1">Details:</div>
                <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-all bg-muted/30 border border-border/40 rounded p-2 text-fg">
                  {moveLiveRunnerPrompt.reason}
                </pre>
              </div>
            </div>
          ) : (
            ""
          )
        }
        confirmLabel="Abort and move"
        tone="danger"
        busy={moveBusy}
        onConfirm={handleMoveAbortAndProceed}
        onClose={() => {
          if (!moveBusy) setMoveLiveRunnerPrompt(null);
        }}
      />
      {vscodeModal}
    </nav>
  );
}

function PinTopbarButton({ sessionId }: { sessionId: string }) {
  const { data } = usePinnedSessions();
  const togglePin = useTogglePinnedSession();
  const isPinned = data?.sessions.includes(sessionId) ?? false;
  return (
    <button
      type="button"
      aria-label={isPinned ? "Unpin session" : "Pin session"}
      title={isPinned ? "Unpin session" : "Pin session"}
      onClick={() => {
        void togglePin(sessionId, isPinned ? "unpin" : "pin");
      }}
      className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition-colors"
    >
      {isPinned ? (
        <StarSolidIcon className="size-4 text-amber-400" />
      ) : (
        <StarIcon className="size-4" />
      )}
    </button>
  );
}

// Horizontal tab strip showing one tab per pinned session. Tab styling:
// no rounded boxes - flat strip with a bottom-border on the active tab
// only, like browser tabs / a tabbed nav. Tabs whose session id isn't in
// the live sessions list are silently skipped so transient opencode
// disconnects don't lose pins. The active session highlights; click
// navigates; the X button calls unpin without affecting the session
// 5-state MCP row used in the hamburger MCP list AND the Session Info
// modal. State drives both the icon (BoltIcon vs BoltSlashIcon for
// failed) and the slider fill color (green=on, orange=needs-auth,
// muted=disabled). Clicking the slider in 'needsAuth' state opens the
// info modal AND signals McpAuthSection (via sessionStorage) to
// auto-start the OAuth handshake on mount - one click takes the user
// from the knob all the way to the OAuth provider in a new tab, then
// the modal's code-paste form is ready when they return.
export function McpRow({
  name,
  kind,
  onToggle,
  onOpenInfo,
}: {
  name: string;
  kind: string;
  onToggle: (name: string, action: "connect" | "disconnect") => Promise<void>;
  onOpenInfo: () => void;
}) {
  const isOn = kind === "connected";
  const needsAuth = kind === "needsAuth";
  const failed = kind === "failed" || kind === "needsClientRegistration";
  const tooltip =
    kind === "connected"
      ? "Connected"
      : kind === "disabled"
        ? "Disabled"
        : kind === "failed"
          ? "Failed - click for details"
          : kind === "needsAuth"
            ? "Needs auth - flip switch to start handshake"
            : kind === "needsClientRegistration"
              ? "Needs client registration"
              : "Unknown";
  const iconColor = isOn
    ? "text-emerald-500"
    : kind === "disabled"
      ? "text-muted-fg/40"
      : needsAuth
        ? "text-amber-500"
        : failed
          ? "text-red-500"
          : "text-muted-fg";
  const Icon = failed ? BoltSlashIcon : BoltIcon;
  const sliderTrack = isOn
    ? "bg-emerald-500"
    : needsAuth
      ? "bg-amber-500"
      : "bg-muted-fg/30";
  const sliderKnobX = isOn ? "translate-x-3.5" : "translate-x-0.5";
  const sliderLabel = isOn
    ? `Disable ${name}`
    : needsAuth
      ? `Start auth for ${name}`
      : `Enable ${name}`;
  const sliderHint = isOn
    ? "On (click to disable)"
    : needsAuth
      ? "Click to start OAuth handshake"
      : "Off (click to enable)";

  return (
    <div
      className="flex w-full items-center gap-2 min-w-0"
      title={`${name} \u2014 ${tooltip}`}
    >
      <Icon className={`size-4 shrink-0 ${iconColor}`} />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      <button
        type="button"
        aria-label={sliderLabel}
        title={sliderHint}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (needsAuth) {
            try {
              sessionStorage.setItem("openportal-mcp-auto-auth", name);
            } catch {
              /* sandboxed sessionStorage - modal will show manual button */
            }
            onOpenInfo();
            return;
          }
          void onToggle(name, isOn ? "disconnect" : "connect");
        }}
        className={`shrink-0 inline-flex h-4 w-7 items-center rounded-full transition-colors ${sliderTrack}`}
      >
        <span
          aria-hidden
          className={`size-3 rounded-full bg-white transition-transform ${sliderKnobX}`}
        />
      </button>
      <button
        type="button"
        aria-label={`MCP info: ${name}`}
        title="Show details"
        className="shrink-0 inline-flex items-center justify-center size-5 rounded text-muted-fg hover:bg-muted hover:text-fg pointer-events-none"
      >
        <QuestionMarkCircleIcon className="size-4" />
      </button>
    </div>
  );
}

// itself (don't conflate "remove from quick-access" with "delete").
//
// Mounted at the very top of the SidebarInset (below only the global
// banners) so it acts as the app's primary navigation chrome on both
// desktop AND mobile.
export function PinnedTabStrip() {
  const { data } = usePinnedSessions();
  const { data: sessionsData } = useSessions();
  const { data: statusMap } = useSessionStatus();
  const { data: questions } = useQuestions();
  const { data: permissions } = usePermissions();
  const { data: lastViewedData } = useLastViewed();
  const errorSessionIdsArr = useSessionErrorStore((s) => s.errors);
  const togglePin = useTogglePinnedSession();
  const reorder = useReorderPinnedSessions();
  const navigate = useNavigate();
  const sessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const currentSessionId = sessionMatch?.params?.id ?? null;
  const { isMobile } = useMediaQuery();

  const pinned = data?.sessions ?? [];
  const sessions: Session[] = sessionsData ?? [];
  // Subagent attention cascades up to the parent main session: if a
  // question / permission / error lands on a subsession, the parent
  // (which is what's actually pinned) needs the red indicator too,
  // otherwise the user sees no signal and has to drill into the sidebar
  // tree to discover the blocking subagent. cascadeIdsToAncestors walks
  // parentID up the chain.
  const questionSessionIds = useMemo(() => {
    const seed = new Set<string>();
    for (const q of questions ?? []) seed.add(q.sessionID);
    for (const p of (permissions ?? []) as Array<{ sessionID?: string }>) {
      if (p.sessionID) seed.add(p.sessionID);
    }
    return cascadeIdsToAncestors(seed, sessions);
  }, [questions, permissions, sessions]);
  const errorSessionIds = useMemo(
    () =>
      cascadeIdsToAncestors(new Set(errorSessionIdsArr), sessions),
    [errorSessionIdsArr, sessions],
  );
  const lastViewedMap = lastViewedData ?? {};
  const tabs = pinned
    .map((id) => ({ id, session: sessions.find((s) => s.id === id) ?? null }))
    .filter((t): t is { id: string; session: Session } => t.session !== null);

  // PointerSensor with distance:8 covers desktop mouse AND modern mobile
  // pointer events; the activation constraint means a tap or click won't
  // start a drag (won't move 8px), so the inner navigate-button + unpin-X
  // button keep their click semantics. TouchSensor is a fallback for older
  // mobile browsers that emit touch events without pointer-event coalescing
  // - delay:150ms + tolerance:5 prevents accidental drags during scroll.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  if (tabs.length === 0) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = pinned.indexOf(active.id as string);
    const to = pinned.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    const next = arrayMove(pinned, from, to);
    void reorder(next);
  };

  // Mobile gets a plain horizontally-scrollable strip - no drag, no
  // touch-none, no SortableContext - because press-and-hold drag fights
  // the user's swipe-to-scroll intent on a phone. Desktop keeps the
  // full DnD wrapper for click-and-drag reordering with a mouse.
  const renderTabs = (sortable: boolean) =>
    tabs.map(({ id, session }) => {
      const active = id === currentSessionId;
      const title = session.title ?? "(untitled)";
      const hasDraft = sessionHasDraft(id);
      const hasNewContent = sessionHasNewContent(
        session,
        lastViewedMap,
        currentSessionId,
      );
      const hasQuestion = questionSessionIds.has(id);
      const hasError = errorSessionIds.has(id);
      const tabStatus = statusMap?.[id]?.type;
      const hasStatusDot =
        hasQuestion ||
        hasError ||
        tabStatus === "busy" ||
        tabStatus === "retry" ||
        hasNewContent;
      const hasAnyIndicator = hasDraft || hasStatusDot;
      return (
        <SortablePinnedTab
          key={id}
          id={id}
          sortable={sortable}
          active={active}
          title={title}
          hasAnyIndicator={hasAnyIndicator}
          hasDraft={hasDraft}
          tabStatus={tabStatus}
          hasNewContent={hasNewContent}
          hasQuestion={hasQuestion}
          hasError={hasError}
          onUnpin={() => void togglePin(id, "unpin")}
        />
      );
    });

  if (isMobile) {
    return (
      <div className="flex shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border bg-bg/95 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {renderTabs(false)}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext
        items={tabs.map((t) => t.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border bg-bg/95 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {renderTabs(true)}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface SortablePinnedTabProps {
  id: string;
  sortable: boolean;
  active: boolean;
  title: string;
  hasAnyIndicator: boolean;
  hasDraft: boolean;
  tabStatus: "busy" | "retry" | "idle" | undefined;
  hasNewContent: boolean;
  hasQuestion: boolean;
  hasError: boolean;
  onUnpin: () => void;
}

function SortablePinnedTab({
  id,
  sortable,
  active,
  title,
  hasAnyIndicator,
  hasDraft,
  tabStatus,
  hasNewContent,
  hasQuestion,
  hasError,
  onUnpin,
}: SortablePinnedTabProps) {
  if (!sortable) {
    return (
      <NonSortablePinnedTab
        tabId={id}
        active={active}
        title={title}
        hasAnyIndicator={hasAnyIndicator}
        hasDraft={hasDraft}
        tabStatus={tabStatus}
        hasNewContent={hasNewContent}
        hasQuestion={hasQuestion}
        hasError={hasError}
        id={id}
        onUnpin={onUnpin}
      />
    );
  }
  return (
    <SortableTabInner
      id={id}
      active={active}
      title={title}
      hasAnyIndicator={hasAnyIndicator}
      hasDraft={hasDraft}
      tabStatus={tabStatus}
      hasNewContent={hasNewContent}
      hasQuestion={hasQuestion}
      hasError={hasError}
      onUnpin={onUnpin}
    />
  );
}

type TabVisualProps = Omit<SortablePinnedTabProps, "sortable">;

function NonSortablePinnedTab({ tabId, ...props }: TabVisualProps & { tabId?: string }) {
  return (
    <PinnedTabContent
      {...props}
      tabId={tabId}
      className={`group relative flex items-center gap-0 -mb-px border-b-2 pl-0 pr-0 py-1 text-xs transition-colors shrink-0 ${
        props.active
          ? "border-primary bg-bg text-fg"
          : "border-transparent text-muted-fg hover:bg-muted/30 hover:text-fg"
      }`}
    />
  );
}

function SortableTabInner({ id, ...visual }: TabVisualProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-test={`portal-pinnedtab-${id}`}
      className={`group relative flex items-center gap-0 -mb-px border-b-2 pl-0 pr-0 py-1 text-xs transition-colors shrink-0 cursor-grab active:cursor-grabbing touch-none ${
        visual.active
          ? "border-primary bg-bg text-fg"
          : "border-transparent text-muted-fg hover:bg-muted/30 hover:text-fg"
      }`}
    >
      <PinnedTabInner {...visual} id={id} />
    </div>
  );
}

function PinnedTabContent({
  className,
  tabId,
  ...visual
}: TabVisualProps & { className: string; tabId?: string }) {
  return (
    <div className={className} data-test={tabId ? `portal-pinnedtab-${tabId}` : undefined}>
      <PinnedTabInner {...visual} />
    </div>
  );
}

function PinnedTabInner(visual: TabVisualProps) {
  const {
    title,
    hasAnyIndicator,
    hasDraft,
    tabStatus,
    hasNewContent,
    hasQuestion,
    hasError,
    onUnpin,
  } = visual;
  return (
    <>
      {hasAnyIndicator && (
        <div className="flex items-center gap-0.5 pl-1 pr-1">
          <DraftIndicator hasDraft={hasDraft} reserveSpace={false} />
          <SessionStatusDot
            status={tabStatus}
            hasNewContent={hasNewContent}
            hasQuestion={hasQuestion}
            hasError={hasError}
            reserveSpace={false}
          />
        </div>
      )}
      <a
        href={`/session/${visual.id}`}
        className="max-w-[16rem] truncate text-left"
        title={title}
      >
        {title}
      </a>
      <button
        type="button"
        onClick={onUnpin}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Unpin ${title}`}
        title="Unpin"
        className="rounded p-0.5 hover:bg-muted/40"
      >
        <XMarkIcon className="size-3" />
      </button>
    </>
  );
}

interface SpawnInfo {
  childID: string;
  parentSessionID: string | null;
  spawnMessageID: string | null;
  spawnToolPartID: string | null;
  finishMessageID: string | null;
}

function SubagentJumpButtons({
  childID,
  port,
  parentSessionID,
  parentTitle,
}: {
  childID: string;
  port: number;
  parentSessionID: string;
  parentTitle: string;
}) {
  const navigate = useNavigate();
  const spawnUrl =
    port && childID
      ? `/api/opencode/${port}/session/${encodeURIComponent(childID)}/spawn-info`
      : null;
  const { data } = useSWR<SpawnInfo>(spawnUrl, async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`spawn-info HTTP ${r.status}`);
    return r.json();
  });
  const parentHref = (msgID: string | null) =>
    hrefWithCurrentSearch(
      `/session/${parentSessionID}`,
      undefined,
      msgID ? `msg-${msgID}` : undefined,
    );
  const baseClass =
    "shrink-0 inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-500/20 dark:text-violet-300";

  const doFork = async (
    targetSessionID: string,
    messageID: string | null,
    label: string,
  ) => {
    toast.info(`Forking: ${label}...`);
    try {
      const r = await fetch(
        `/api/opencode/${port}/session/${encodeURIComponent(targetSessionID)}/fork`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(messageID ? { messageID } : {}),
        },
      );
      if (!r.ok) {
        toast.error(`Fork failed: HTTP ${r.status}`);
        return;
      }
      const body = (await r.json()) as { id?: string };
      if (body?.id) {
        toast.success(`Forked to ${body.id}`);
        void navigate({
          to: "/session/$id",
          params: { id: body.id },
          search: true,
        });
      } else {
        toast.success("Forked");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fork request failed.");
    }
  };

  return (
    <>
      <a
        href={parentHref(data?.spawnMessageID ?? null)}
        aria-label="Jump to where parent spawned this subagent"
        title={
          data?.spawnMessageID
            ? `Jump to parent message that spawned this subagent (${parentTitle})`
            : `Jump to parent session: ${parentTitle}`
        }
        data-test="portal-jump-to-parent-spawn"
        className={baseClass}
      >
        <ArrowLeftIcon className="size-3.5" />
        Spawn
      </a>
      {data?.finishMessageID && (
        <a
          href={parentHref(data.finishMessageID)}
          aria-label="Jump to where parent resumed after this subagent finished"
          title={`Jump to parent's next message after this subagent finished (${parentTitle})`}
          data-test="portal-jump-to-parent-finish"
          className={baseClass}
        >
          <ArrowLeftIcon className="size-3.5" />
          Resumed
        </a>
      )}
      <Menu>
        <MenuTrigger
          aria-label="Fork options"
          className={baseClass}
          data-test="portal-fork-subagent-menu"
        >
          Fork...
        </MenuTrigger>
        <MenuContent placement="bottom end" className="min-w-72">
          <MenuItem
            onAction={() => void doFork(childID, null, "this subagent session")}
            data-test="portal-fork-subagent"
          >
            Fork this subagent session (from end)
          </MenuItem>
          {data?.spawnMessageID && (
            <MenuItem
              onAction={() =>
                void doFork(
                  parentSessionID,
                  data.spawnMessageID,
                  "parent at spawn point",
                )
              }
              data-test="portal-fork-parent-spawn"
            >
              Fork parent at spawn point
            </MenuItem>
          )}
          {data?.finishMessageID && (
            <MenuItem
              onAction={() =>
                void doFork(
                  parentSessionID,
                  data.finishMessageID,
                  "parent at resumed point",
                )
              }
              data-test="portal-fork-parent-finish"
            >
              Fork parent at resumed point
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
    </>
  );
}
