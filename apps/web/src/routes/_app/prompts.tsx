import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnRightIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog as PrimitiveDialog,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { PageTitle } from "@/components/ui/typography";
import { MODAL_OVERLAY_CLASSES } from "@/lib/ui-classes";
import { toast } from "@/components/ui/toast";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import { MarkdownRenderer } from "@/lib/markdown-renderer";
import { useDateFormatStore } from "@/stores/date-format-store";
import { useSessions } from "@/hooks/use-opencode";
import type { Session } from "@opencode-ai/sdk";
import {
  formatAbsoluteAndRelative,
  formatMessageTime,
} from "@/lib/format-time";
import { useInstanceStore } from "@/stores/instance-store";
import {
  clearPendingSubmission,
  usePendingSubmissions,
  type PendingPromptEntry,
} from "@/lib/pending-prompts";

interface PromptsSearch {
  focus?: string;
}

export const Route = createFileRoute("/_app/prompts")({
  validateSearch: (raw): PromptsSearch => ({
    focus: typeof raw.focus === "string" ? raw.focus : undefined,
  }),
  component: PromptsPage,
});

interface PromptRow {
  id: string;
  ts_ms: number;
  project_path: string;
  session_id: string;
  parent_session_id: string | null;
  raw_text: string;
  raw_text_unfiltered: string;
  model_provider: string | null;
  model_id: string | null;
  agent: string | null;
  variant: string | null;
  source: "prompt" | "command";
  attachments_count: number;
  status?: "pending" | "delivered" | "failed" | "sent";
  attempts?: number;
  last_error?: string | null;
}

interface ListResponse {
  rows: PromptRow[];
  nextCursor: number | null;
}

type ViewMode = "tree" | "flat";

const fetcher = async (url: string): Promise<ListResponse> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function buildListUrl(q: string, cursor: number | null): string {
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set("q", q.trim());
  if (cursor !== null) params.set("cursor", String(cursor));
  params.set("limit", "100");
  return `/api/prompts?${params.toString()}`;
}

function buildExportUrl(q: string): string {
  const params = new URLSearchParams();
  if (q.trim().length > 0) params.set("q", q.trim());
  const qs = params.toString();
  return qs.length > 0
    ? `/api/prompts/export?${qs}`
    : "/api/prompts/export";
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

function basename(path: string): string {
  const t = path.replace(/\/+$/g, "");
  const last = t.split("/").pop();
  return last || path || "(unknown)";
}

type Scope = "session" | "project" | "global";

function PromptsPage() {
  const { setPageTitle } = useBreadcrumb();
  const search = useSearch({ from: "/_app/prompts" });
  const [q, setQ] = useState("");
  const [view, setView] = useState<ViewMode>("tree");
  const [refireTargetId, setRefireTargetId] = useState<string | null>(null);
  const [extraPages, setExtraPages] = useState<PromptRow[][]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scope, setScope] = useState<Scope>(() =>
    search.focus ? "session" : "global",
  );

  const { data: sessionsData } = useSessions();
  const sessionsById = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of sessionsData ?? []) m.set(s.id, s);
    return m;
  }, [sessionsData]);
  const sessionTitleFor = (sid: string): string | null => {
    return sessionsById.get(sid)?.title ?? null;
  };

  useEffect(() => {
    setPageTitle("Prompt history");
    return () => setPageTitle(null);
  }, [setPageTitle]);

  const { data, error, isLoading, mutate } = useSWR<ListResponse>(
    buildListUrl(q, null),
    fetcher,
    { revalidateOnFocus: false },
  );

  // Reset accumulated pages whenever the search query changes - the
  // first SWR page covers the new query result; subsequent load-more
  // clicks fetch with cursor from that result onward.
  useEffect(() => {
    setExtraPages([]);
    setNextCursor(data?.nextCursor ?? null);
  }, [q, data?.nextCursor]);

  const rows = useMemo(() => {
    const first = data?.rows ?? [];
    if (extraPages.length === 0) return first;
    return [...first, ...extraPages.flat()];
  }, [data?.rows, extraPages]);

  const focusProjectPath = useMemo(() => {
    if (!search.focus) return null;
    const row = rows.find((r) => r.session_id === search.focus);
    return row?.project_path ?? null;
  }, [rows, search.focus]);

  // Client-side scope filter, layered on top of the backend FTS
  // filter. v1 is intentionally client-side so we don't need an
  // /api/prompts schema change; the trade-off is that 'this session'
  // / 'this project' can only filter prompts already loaded into
  // memory. Backend filter params are a follow-up.
  const scopedRows = useMemo(() => {
    if (scope === "session" && search.focus) {
      return rows.filter((r) => r.session_id === search.focus);
    }
    if (scope === "project" && focusProjectPath) {
      return rows.filter((r) => r.project_path === focusProjectPath);
    }
    return rows;
  }, [rows, scope, search.focus, focusProjectPath]);

  const loadMore = async () => {
    if (loadingMore || nextCursor === null) return;
    setLoadingMore(true);
    try {
      const res = await fetcher(buildListUrl(q, nextCursor)) as ListResponse;
      setExtraPages((prev) => [...prev, res.rows]);
      setNextCursor(res.nextCursor ?? null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load more prompts",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="-m-4 flex flex-1 flex-col min-h-0">
      <StaleDataBanner
        headline="Showing cached prompt history - OpenCode is unreachable."
        hint="The archive is served from OpenPortal's local SQLite. Re-firing a prompt into a session will fail until OpenCode is back."
      />
      <div className="flex flex-col gap-1 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:gap-2 sm:px-4">
        <div className="relative flex flex-1 items-center min-w-0">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2 size-4 text-muted-fg" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search filtered text (FTS5)…"
            className="w-full rounded-md border border-border bg-bg px-8 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {q.length > 0 && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-1 inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/50 hover:text-fg"
              aria-label="Clear search"
            >
              <XMarkIcon className="size-4" />
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {search.focus && (
            <div
              className="inline-flex rounded-md border border-border p-0.5 text-[11px]"
              role="group"
              aria-label="Filter scope"
            >
              {(["session", "project", "global"] as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`px-1.5 py-0.5 rounded-sm transition-colors ${
                    scope === s
                      ? "bg-primary/10 text-primary"
                      : "text-muted-fg hover:text-fg"
                  }`}
                  title={
                    s === "session"
                      ? "Only prompts from the session you opened from"
                      : s === "project"
                        ? "Prompts from any session in the same project"
                        : "All prompts across all projects"
                  }
                >
                  {s === "session"
                    ? "Session"
                    : s === "project"
                      ? "Project"
                      : "Global"}
                </button>
              ))}
            </div>
          )}
          <div className="inline-flex rounded-md border border-border p-0.5 text-[11px]">
            {(["tree", "flat"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                className={`px-1.5 py-0.5 rounded-sm transition-colors ${
                  view === m
                    ? "bg-primary/10 text-primary"
                    : "text-muted-fg hover:text-fg"
                }`}
              >
                {m === "tree" ? "Tree" : "Flat"}
              </button>
            ))}
          </div>
          <Button
            intent="secondary"
            size="sm"
            onPress={() => void mutate()}
            aria-label="Refresh"
          >
            <ArrowPathIcon className="size-4" />
          </Button>
          <a
            href={buildExportUrl(q)}
            download
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-xs hover:bg-muted/30"
            title="Download every matching prompt as NDJSON"
          >
            <ArrowDownTrayIcon className="size-4" />
            <span className="hidden sm:inline">Export</span>
          </a>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-2 py-2 sm:px-4">
        <PendingSubmissionsBanner />
        {isLoading && (
          <div className="flex flex-1 min-h-0 items-center justify-center">
            <Loader className="size-6" />
          </div>
        )}
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-sm text-danger-subtle-fg">
            Failed to load: {error.message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="flex flex-1 flex-col min-h-0 items-center justify-center gap-2 text-center text-sm text-muted-fg">
            <p>No prompts archived yet.</p>
            <p className="text-xs">
              Submissions to /prompt and /command capture into this archive
              starting from when this feature landed.
            </p>
          </div>
        )}
        {!isLoading && !error && scopedRows.length === 0 && rows.length > 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-fg">
            <p>No prompts match the current scope.</p>
            <button
              type="button"
              onClick={() => setScope("global")}
              className="text-xs underline hover:text-fg"
            >
              Switch to Global
            </button>
          </div>
        )}
        {!isLoading && !error && scopedRows.length > 0 && (
          <>
            {view === "flat" ? (
              <FlatList
                rows={scopedRows}
                query={q}
                onRefire={setRefireTargetId}
              />
            ) : (
              <TreeView
                rows={scopedRows}
                query={q}
                focusSessionId={search.focus}
                searchActive={q.trim().length > 0}
                onRefire={setRefireTargetId}
                sessionTitleFor={sessionTitleFor}
              />
            )}
            {nextCursor !== null && (
              <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-fg">
                <span>
                  Showing {rows.length} prompt
                  {rows.length === 1 ? "" : "s"}; more rows exist.
                </span>
                <Button
                  intent="secondary"
                  size="sm"
                  onPress={() => void loadMore()}
                  isDisabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader className="size-3" />
                      Loading...
                    </>
                  ) : (
                    "Load more"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <RefireModal
        promptId={refireTargetId}
        onClose={() => setRefireTargetId(null)}
      />
    </div>
  );
}

function FlatList({
  rows,
  query,
  onRefire,
}: {
  rows: PromptRow[];
  query: string;
  onRefire: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((row) => (
        <li key={row.id} className="py-2">
          <PromptRowItem
            row={row}
            query={query}
            onRefire={() => onRefire(row.id)}
          />
        </li>
      ))}
    </ul>
  );
}

interface TreeGroup {
  projectPath: string;
  bySession: Map<string, PromptRow[]>;
  parentBySession: Map<string, string | null>;
}

function buildTree(rows: PromptRow[]): TreeGroup[] {
  const byProject = new Map<string, TreeGroup>();
  for (const r of rows) {
    let g = byProject.get(r.project_path);
    if (!g) {
      g = {
        projectPath: r.project_path,
        bySession: new Map(),
        parentBySession: new Map(),
      };
      byProject.set(r.project_path, g);
    }
    let list = g.bySession.get(r.session_id);
    if (!list) {
      list = [];
      g.bySession.set(r.session_id, list);
    }
    list.push(r);
    if (!g.parentBySession.has(r.session_id)) {
      g.parentBySession.set(r.session_id, r.parent_session_id);
    }
  }
  return Array.from(byProject.values()).sort((a, b) =>
    a.projectPath.localeCompare(b.projectPath),
  );
}

function TreeView({
  rows,
  query,
  focusSessionId,
  searchActive,
  onRefire,
  sessionTitleFor,
}: {
  rows: PromptRow[];
  query: string;
  focusSessionId: string | undefined;
  searchActive: boolean;
  onRefire: (id: string) => void;
  sessionTitleFor?: (sid: string) => string | null;
}) {
  const groups = useMemo(() => buildTree(rows), [rows]);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(
    () => new Set(),
  );

  // Seed collapse state once, after groups first arrive. With a focus
  // session id present (set by the topbar burger when invoked from
  // inside a session page), expand only the project + session that
  // contain it; collapse everything else. Without focus (sidebar
  // footer burger or direct nav), collapse all projects so the user
  // starts from a clean overview. Once seeded, scroll the focused
  // session header into view + highlight it briefly so the user can
  // see where they landed even on a long history page.
  const seededForRef = useRef<string | "none" | null>(null);
  useEffect(() => {
    if (groups.length === 0) return;
    const seedKey = focusSessionId ?? "none";
    if (seededForRef.current === seedKey) return;

    const focusGroup = focusSessionId
      ? groups.find((g) => g.bySession.has(focusSessionId))
      : undefined;
    const focusProject = focusGroup?.projectPath;

    const projs = new Set<string>();
    for (const g of groups) {
      if (g.projectPath !== focusProject) projs.add(g.projectPath);
    }
    setCollapsedProjects(projs);

    const sessions = new Set<string>();
    if (focusGroup && focusSessionId) {
      for (const sid of focusGroup.bySession.keys()) {
        if (sid !== focusSessionId) sessions.add(sid);
      }
    }
    setCollapsedSessions(sessions);
    seededForRef.current = seedKey;

    if (focusSessionId && focusGroup) {
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-prompts-session-id="${CSS.escape(focusSessionId)}"]`,
        );
        if (el instanceof HTMLElement) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-primary", "ring-offset-1");
          setTimeout(() => {
            el.classList.remove("ring-2", "ring-primary", "ring-offset-1");
          }, 1800);
        }
      });
    }
  }, [groups, focusSessionId]);

  const toggleProject = (path: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const toggleSession = (id: string) => {
    setCollapsedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const projectCollapsed = !searchActive && collapsedProjects.has(g.projectPath);
        const totalCount = Array.from(g.bySession.values()).reduce(
          (a, list) => a + list.length,
          0,
        );
        const sessionEntries = Array.from(g.bySession.entries());
        return (
          <div key={g.projectPath}>
            <button
              type="button"
              onClick={() => toggleProject(g.projectPath)}
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm font-semibold hover:bg-muted/30"
            >
              <ChevronRightIcon
                className={`size-3 shrink-0 transition-transform ${projectCollapsed ? "" : "rotate-90"}`}
              />
              <span className="truncate">{basename(g.projectPath)}</span>
              <span className="ml-1 text-xs text-muted-fg">
                ({totalCount})
              </span>
              <span className="ml-2 truncate text-xs font-normal text-muted-fg">
                {g.projectPath}
              </span>
            </button>
            {!projectCollapsed && (
              <div className="ml-3 space-y-1 border-l border-border/40 pl-2">
                {sessionEntries.map(([sessionId, sessionRows]) => {
                  const sessionCollapsed = !searchActive && collapsedSessions.has(sessionId);
                  return (
                    <div
                      key={sessionId}
                      data-prompts-session-id={sessionId}
                      className="rounded transition-shadow"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSession(sessionId)}
                        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-muted/30 min-w-0"
                      >
                        <ChevronRightIcon
                          className={`size-3 shrink-0 transition-transform ${sessionCollapsed ? "" : "rotate-90"}`}
                        />
                        {(() => {
                          const title = sessionTitleFor?.(sessionId) ?? null;
                          return (
                            <>
                              {title && (
                                <span className="truncate font-medium text-fg">
                                  {title}
                                </span>
                              )}
                              <span className="font-mono text-muted-fg shrink-0">
                                {sessionId.slice(0, title ? 8 : 16)}
                                {title ? "" : "…"}
                              </span>
                              <span className="text-muted-fg shrink-0">
                                ({sessionRows.length})
                              </span>
                            </>
                          );
                        })()}
                      </button>
                      {!sessionCollapsed && (
                        <ul className="ml-3 divide-y divide-border/40 border-l border-border/30 pl-2">
                          {sessionRows.map((row) => (
                            <li key={row.id} className="py-2">
                              <PromptRowItem
                                row={row}
                                query={query}
                                onRefire={() => onRefire(row.id)}
                                compact
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PromptRowItem({
  row,
  query,
  onRefire,
  compact,
}: {
  row: PromptRow;
  query: string;
  onRefire: () => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const dateFormat = useDateFormatStore((s) => s.format);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-fg">
        <button
          type="button"
          onClick={() =>
            void navigate({
              to: "/session/$id",
              params: { id: row.session_id },
              search: (prev) => prev,
            })
          }
          title={formatAbsoluteAndRelative(row.ts_ms)}
          className="tabular-nums whitespace-nowrap hover:text-fg hover:underline"
        >
          {formatMessageTime(row.ts_ms, dateFormat)}
        </button>
        {!compact && (
          <>
            <span className="text-muted-fg/60">·</span>
            <span className="truncate">{basename(row.project_path)}</span>
            <span className="text-muted-fg/60">·</span>
            <button
              type="button"
              onClick={() =>
                void navigate({
                  to: "/session/$id",
                  params: { id: row.session_id },
                })
              }
              className="inline-flex items-center gap-0.5 font-mono text-xs hover:text-fg hover:underline"
              title={`Open session ${row.session_id}`}
            >
              {row.session_id.slice(0, 12)}…
              <ArrowTopRightOnSquareIcon className="size-3" />
            </button>
          </>
        )}
        {row.source === "command" && (
          <span className="rounded bg-muted/40 px-1 py-0.5 text-[10px] uppercase">
            cmd
          </span>
        )}
        {row.status === "pending" && (
          <span
            className="rounded bg-warning-subtle/60 px-1 py-0.5 text-[10px] uppercase tracking-wide text-warning-subtle-fg"
            title={
              row.attempts && row.attempts > 0
                ? `OpenPortal has the prompt but hasn't yet delivered it to OpenCode. ${row.attempts} delivery attempt(s).${row.last_error ? "\nLast error: " + row.last_error : ""}`
                : "OpenPortal has the prompt but hasn't yet delivered it to OpenCode."
            }
          >
            Waiting for OpenCode
          </span>
        )}
        {row.status === "failed" && (
          <span
            className="rounded bg-danger-subtle/60 px-1 py-0.5 text-[10px] uppercase tracking-wide text-danger-subtle-fg"
            title={
              row.last_error
                ? `Delivery to OpenCode gave up after retries. ${row.last_error}`
                : "Delivery to OpenCode gave up after retries."
            }
          >
            Failed
          </span>
        )}
        {row.model_id && (
          <span className="text-[10px] text-muted-fg/80">{row.model_id}</span>
        )}
      </div>
      {query.trim().length > 0 ? (
        <div className="whitespace-pre-wrap break-words text-sm">
          {highlightMatch(row.raw_text, query.trim())}
        </div>
      ) : (
        <MarkdownRenderer
          source={row.raw_text}
          className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_code]:break-words [&_code]:[overflow-wrap:anywhere]"
        />
      )}
      <div className="flex items-center gap-1 pt-1">
        <button
          type="button"
          onClick={onRefire}
          title="Re-fire this prompt into a session"
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs hover:bg-muted/30"
        >
          <ArrowUturnRightIcon className="size-3" />
          Re-fire
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(row.raw_text);
            toast.success("Copied filtered text");
          }}
          title="Copy filtered text"
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs hover:bg-muted/30"
        >
          <ClipboardDocumentIcon className="size-3" />
          Copy
        </button>
      </div>
    </div>
  );
}

function RefireModal({
  promptId,
  onClose,
}: {
  promptId: string | null;
  onClose: () => void;
}) {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { data: sessionsResp } = useSessions();
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const sessions: Array<{ id: string; title?: string; directory?: string }> =
    sessionsResp?.sessions ?? sessionsResp ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return sessions.slice(0, 50);
    return sessions
      .filter((s) => {
        const hay = `${s.title ?? ""} ${s.id} ${s.directory ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }, [sessions, search]);

  const handleRefire = async (targetSessionId: string) => {
    if (!promptId || !port || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/prompts/${promptId}/refire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPort: port, targetSessionId }),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body.slice(0, 200));
      }
      toast.success("Re-fired into session");
      onClose();
      void navigate({
        to: "/session/$id",
        params: { id: targetSessionId },
      });
    } catch (err) {
      toast.error(
        `Re-fire failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalOverlay
      isOpen={promptId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={MODAL_OVERLAY_CLASSES}
    >
      <Modal>
        <PrimitiveDialog className="mx-auto flex w-[min(36rem,95vw)] max-h-[85vh] flex-col rounded-md border border-border bg-bg shadow-lg outline-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Re-fire into session</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-6 items-center justify-center rounded hover:bg-muted/50"
            >
              <XMarkIcon className="size-4" />
            </button>
          </div>
          <div className="border-b border-border px-4 py-2">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-fg" />
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sessions by title, id, or path…"
                className="w-full rounded-md border border-border bg-bg px-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <ul className="flex-1 divide-y divide-border/40 overflow-auto">
            {filtered.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-fg">
                No sessions match.
              </li>
            )}
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleRefire(s.id)}
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm hover:bg-muted/30 disabled:opacity-50"
                >
                  <span className="font-medium">
                    {s.title || "(untitled)"}
                  </span>
                  <span className="text-xs text-muted-fg font-mono">
                    {s.id}
                  </span>
                  {s.directory && (
                    <span className="truncate text-xs text-muted-fg/80">
                      {s.directory}
                    </span>
                  )}
              </button>
            </li>
            ))}
          </ul>
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

// Bulletproof prompt history Phase 2+3: render pending localStorage
// entries above the backend archive list AND auto-reconcile orphans
// older than ORPHAN_RECONCILE_AFTER_MS to /api/prompts/persist-orphan
// so they survive a browser localStorage clear. User invariant: 'No
// prompts, ever, must be lost. Even if openportal is down, for a
// brief moment or for hours!'
const ORPHAN_RECONCILE_AFTER_MS = 60_000;
const reconcileInFlight = new Set<string>();
async function reconcileOrphan(entry: PendingPromptEntry): Promise<void> {
  if (reconcileInFlight.has(entry.localId)) return;
  reconcileInFlight.add(entry.localId);
  try {
    const res = await fetch("/api/prompts/persist-orphan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (res.ok) {
      clearPendingSubmission(entry.localId);
    }
  } catch {
  } finally {
    reconcileInFlight.delete(entry.localId);
  }
}
function PendingSubmissionsBanner() {
  const pending = usePendingSubmissions();
  useEffect(() => {
    const now = Date.now();
    for (const entry of pending) {
      if (now - entry.submittedAt < ORPHAN_RECONCILE_AFTER_MS) continue;
      void reconcileOrphan(entry);
    }
  }, [pending]);
  if (pending.length === 0) return null;
  return (
    <div
      className="mb-3 rounded-md border border-warning/40 bg-warning-bg/30 p-2 text-xs"
      data-test="portal-prompts-pending-banner"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-medium text-warning-subtle-fg">
          {pending.length} prompt
          {pending.length === 1 ? "" : "s"} captured locally — not sent to
          backend
        </span>
        <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-subtle-fg">
          not sent
        </span>
      </div>
      <ul className="space-y-1.5">
        {pending.map((entry) => (
          <PendingEntryRow key={entry.localId} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function PendingEntryRow({ entry }: { entry: PendingPromptEntry }) {
  const submittedAt = new Date(entry.submittedAt);
  const ageMs = Date.now() - entry.submittedAt;
  const ageLabel =
    ageMs < 60_000
      ? `${Math.floor(ageMs / 1000)}s ago`
      : ageMs < 3_600_000
        ? `${Math.floor(ageMs / 60_000)}m ago`
        : ageMs < 86_400_000
          ? `${Math.floor(ageMs / 3_600_000)}h ago`
          : `${Math.floor(ageMs / 86_400_000)}d ago`;
  return (
    <li className="flex items-start gap-2 rounded border border-warning/20 bg-bg/50 p-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px] text-muted-fg">
          <span title={submittedAt.toLocaleString()}>{ageLabel}</span>
          <span>·</span>
          <span className="font-mono">
            {entry.sessionId.slice(0, 12)}…
          </span>
          {entry.attempts > 1 && (
            <span className="text-danger">
              ×{entry.attempts} attempts
            </span>
          )}
          {entry.lastError && (
            <span
              className="truncate text-danger"
              title={entry.lastError}
            >
              {entry.lastError}
            </span>
          )}
        </div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">
          {entry.kind === "command" && (
            <span className="font-mono text-accent">/{entry.commandName}</span>
          )}
          {entry.kind === "command" ? " " : ""}
          {entry.text.length > 200
            ? `${entry.text.slice(0, 200)}…`
            : entry.text}
        </div>
      </div>
      <button
        type="button"
        onClick={() => clearPendingSubmission(entry.localId)}
        className="shrink-0 rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] hover:bg-muted"
        title="Remove this entry from local storage (the prompt has been seen / acknowledged)"
        data-test="portal-prompts-pending-delete"
      >
        Drop
      </button>
    </li>
  );
}
