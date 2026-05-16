import { useEffect, useMemo, useRef, useState } from "react";
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
  ArrowLeftIcon,
  BoltIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  FolderOpenIcon,
  InformationCircleIcon,
  PencilSquareIcon,
  QuestionMarkCircleIcon,
  StarIcon,
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
import { SessionInfoModal } from "@/components/session-info-modal";
import { McpInfoModal } from "@/components/mcp-info-modal";
import { PluginInfoModal } from "@/components/plugin-info-modal";
import { useHashOpen, useHashValue } from "@/hooks/use-hash-open";
import { SidebarNav, SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import { useFileBrowserPanelStore } from "@/stores/file-browser-panel-store";
import { useInstanceStore } from "@/stores/instance-store";
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
import useMediaQuery from "@/hooks/use-media-query";
import {
  sessionHasDraft,
  sessionHasNewContent,
  SessionStatusDot,
  DraftIndicator,
} from "@/lib/session-indicators";
import { cascadeIdsToAncestors } from "@/lib/project-path";
import type { Session } from "@opencode-ai/sdk";

// Take the deepest path component and use it as a short project label.
// session.directory can be absolute ('/home/u/projekty/nowaker/blah') or
// even a single-segment short name; either way the basename is what we
// surface in the topbar + browser tab.
function projectLabelFromDirectory(directory?: string): string | null {
  if (!directory) return null;
  const parts = directory.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

export function AppSidebarNav() {
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port ?? 0;
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
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const enabledTools = useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        systemOverrides,
        customTools,
      }).filter((tool) => tool.enabled),
    [disabledIds, systemOverrides, customTools],
  );

  const [runningToolId, setRunningToolId] = useState<string | null>(null);
  const [showSessionInfo, setShowSessionInfo] = useHashOpen("info");
  const [mcpInfoName, setMcpInfoName] = useHashValue("mcp");
  const [pluginInfoSpec, setPluginInfoSpec] = useHashValue("plugin");

  const sessionMatch = useMatch({
    from: "/_app/session/$id",
    shouldThrow: false,
  });
  const sessionId = sessionMatch?.params?.id;
  const sessions: Session[] = sessionsData ?? [];
  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title ?? null;
  const projectLabel = projectLabelFromDirectory(currentSession?.directory);
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
    try {
      const selectedModel = resolveModel(sessionId, instanceId);
      const response = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: prompt, model: selectedModel }),
        },
      );
      if (!response.ok) throw new Error("Failed to send request");
      mutateSessionMessages(port, sessionId);
      mutateSessions();
      toast.success(`${label} request sent`);
    } catch (err) {
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
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/opencode/${port}/session/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await mutateSessions();
      setEditingTitle(false);
      setDraftTitle("");
    } catch (e) {
      toast.error(
        `Failed to rename: ${e instanceof Error ? e.message : "unknown"}`,
      );
    } finally {
      setRenameSaving(false);
    }
  };

  const showPageTitle = !sessionId && !!pageTitle;

  return (
    <SidebarNav isSticky>
      <span className="flex items-center gap-x-1 min-w-0 flex-1">
        <SidebarTrigger className="-ml-2 px-0 shrink-0" />
        {showPageTitle && (
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                window.history.back();
              } else {
                void navigate({ to: "/" });
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
            <span className="min-w-0 truncate text-sm font-medium text-fg">
              {sessionTitle ? (
                <>
                  {projectLabel && currentSession?.directory && (
                    <button
                      type="button"
                      onClick={() => {
                        const dir = currentSession.directory;
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
                  {projectLabel && currentSession?.directory && (
                    <span className="text-muted-fg">: </span>
                  )}
                  {isSubagent ? (
                    <>
                      {parentSession?.title ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!parentSession?.id) return;
                            void navigate({
                              to: "/session/$id",
                              params: { id: parentSession.id },
                            });
                          }}
                          className="text-muted-fg hover:text-fg hover:underline underline-offset-2"
                          title={`Open parent session: ${parentSession.title}`}
                        >
                          {parentSession.title}
                        </button>
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
                <>
                  <span className="text-muted-fg">
                    {instance?.name ?? "OpenPortal"}
                  </span>
                  <span className="text-muted-fg">: </span>
                  <span>{pageTitle}</span>
                </>
              ) : (
                <span className="text-muted-fg">
                  {instance?.name ?? "OpenPortal"}
                </span>
              )}
            </span>
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
          </>
        )}
      </span>
      <span className="flex items-center gap-x-2 ml-auto shrink-0">
        {!isMobile && sessionId && <PinTopbarButton sessionId={sessionId} />}
        <Menu>
          <MenuTrigger aria-label="Open menu">
            <Button intent="outline" size="sq-sm">
              <EllipsisVerticalIcon className="size-4" />
            </Button>
          </MenuTrigger>
          <MenuContent placement="bottom end" className="min-w-56">
            <MenuSection>
              <MenuItem
                onAction={() => {
                  void navigate({
                    to: "/prompts",
                    search: sessionId ? { focus: sessionId } : {},
                  });
                }}
              >
                <ArchiveBoxIcon className="size-4" data-slot="icon" />
                Prompt history
              </MenuItem>
              <MenuItem
                onAction={() => {
                  void navigate({ to: "/pinned" });
                }}
              >
                <StarIcon className="size-4" data-slot="icon" />
                Pinned messages
              </MenuItem>
              <MenuItem
                onAction={() => {
                  if (
                    typeof window !== "undefined" &&
                    window.matchMedia("(min-width: 768px)").matches
                  ) {
                    useFileBrowserPanelStore.getState().toggle(null);
                  } else {
                    window.open("/files", "_blank", "noopener");
                  }
                }}
              >
                <FolderOpenIcon className="size-4" data-slot="icon" />
                File browser
              </MenuItem>
            </MenuSection>
            {sessionId && <MenuSeparator />}
            {sessionId && (
                <MenuSection>
                  <MenuItem onAction={() => setShowSessionInfo(true)}>
                    <InformationCircleIcon
                      className="size-4"
                      data-slot="icon"
                    />
                    Session info
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
                  {mcpEntries.map(([name, status]) => {
                    const kind = status.status;
                    const isOn = kind !== "disabled";
                    const tooltip =
                      kind === "connected"
                        ? "Connected"
                        : kind === "disabled"
                          ? "Disabled"
                          : kind === "failed"
                            ? "Failed"
                            : kind === "needsAuth"
                              ? "Needs auth"
                              : kind === "needsClientRegistration"
                                ? "Needs client registration"
                                : "Unknown";
                    const iconColor =
                      kind === "disabled"
                        ? "text-muted-fg/40"
                        : "text-muted-fg";
                    return (
                      <MenuItem
                        key={name}
                        textValue={name}
                        onAction={() => setMcpInfoName(name)}
                      >
                        <div
                          className="flex w-full items-center gap-2 min-w-0"
                          title={`${name} \u2014 ${tooltip}`}
                        >
                          <BoltIcon
                            className={`size-4 shrink-0 ${iconColor}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {name}
                          </span>
                          <button
                            type="button"
                            aria-label={
                              isOn ? `Disable ${name}` : `Enable ${name}`
                            }
                            title={isOn ? "On (click to disable)" : "Off (click to enable)"}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleMcp(
                                name,
                                isOn ? "disconnect" : "connect",
                              );
                            }}
                            className={`shrink-0 inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                              isOn ? "bg-emerald-500" : "bg-muted-fg/30"
                            }`}
                          >
                            <span
                              aria-hidden
                              className={`size-3 rounded-full bg-white transition-transform ${
                                isOn ? "translate-x-3.5" : "translate-x-0.5"
                              }`}
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
                      </MenuItem>
                    );
                  })}
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
                      onAction={() => setPluginInfoSpec(p.spec)}
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
                        <button
                          type="button"
                          aria-label={`Plugin info: ${p.label}`}
                          title="Show plugin details"
                          className="shrink-0 inline-flex items-center justify-center size-5 rounded text-muted-fg hover:bg-muted hover:text-fg pointer-events-none"
                        >
                          <QuestionMarkCircleIcon className="size-4" />
                        </button>
                      </div>
                    </MenuItem>
                  ))}
                </MenuSection>
              )}
            </MenuContent>
          </Menu>
      </span>
      {sessionId && (
        <SessionInfoModal
          isOpen={showSessionInfo}
          sessionId={sessionId}
          onOpenChange={setShowSessionInfo}
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
    </SidebarNav>
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
          onNavigate={() =>
            void navigate({ to: "/session/$id", params: { id } })
          }
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
  onNavigate: () => void;
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
  onNavigate,
  onUnpin,
}: SortablePinnedTabProps) {
  if (!sortable) {
    return (
      <NonSortablePinnedTab
        active={active}
        title={title}
        hasAnyIndicator={hasAnyIndicator}
        hasDraft={hasDraft}
        tabStatus={tabStatus}
        hasNewContent={hasNewContent}
        hasQuestion={hasQuestion}
        hasError={hasError}
        onNavigate={onNavigate}
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
      onNavigate={onNavigate}
      onUnpin={onUnpin}
    />
  );
}

type TabVisualProps = Omit<SortablePinnedTabProps, "id" | "sortable">;

function NonSortablePinnedTab(props: TabVisualProps) {
  return (
    <PinnedTabContent
      {...props}
      className={`group relative flex items-center gap-0 -mb-px border-b-2 pl-0 pr-0 py-1 text-xs transition-colors shrink-0 ${
        props.active
          ? "border-primary bg-bg text-fg"
          : "border-transparent text-muted-fg hover:bg-muted/30 hover:text-fg"
      }`}
    />
  );
}

function SortableTabInner({ id, ...visual }: { id: string } & TabVisualProps) {
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
      className={`group relative flex items-center gap-0 -mb-px border-b-2 pl-0 pr-0 py-1 text-xs transition-colors shrink-0 cursor-grab active:cursor-grabbing touch-none ${
        visual.active
          ? "border-primary bg-bg text-fg"
          : "border-transparent text-muted-fg hover:bg-muted/30 hover:text-fg"
      }`}
    >
      <PinnedTabInner {...visual} />
    </div>
  );
}

function PinnedTabContent({
  className,
  ...visual
}: TabVisualProps & { className: string }) {
  return (
    <div className={className}>
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
    onNavigate,
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
      <button
        type="button"
        onClick={onNavigate}
        className="max-w-[16rem] truncate text-left"
        title={title}
      >
        {title}
      </button>
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
