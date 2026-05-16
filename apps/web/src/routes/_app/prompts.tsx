import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnRightIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  EyeIcon,
  EyeSlashIcon,
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
import { useSessions } from "@/hooks/use-opencode";
import {
  formatAbsoluteAndRelative,
  formatRelativeTime,
} from "@/lib/format-time";
import { useInstanceStore } from "@/stores/instance-store";

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

function basename(path: string): string {
  const t = path.replace(/\/+$/g, "");
  const last = t.split("/").pop();
  return last || path || "(unknown)";
}

function PromptsPage() {
  const { setPageTitle } = useBreadcrumb();
  const search = useSearch({ from: "/_app/prompts" });
  const [q, setQ] = useState("");
  const [view, setView] = useState<ViewMode>("tree");
  const [refireTargetId, setRefireTargetId] = useState<string | null>(null);
  const [expandedRawIds, setExpandedRawIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setPageTitle("Prompt history");
    return () => setPageTitle(null);
  }, [setPageTitle]);

  const { data, error, isLoading, mutate } = useSWR<ListResponse>(
    buildListUrl(q, null),
    fetcher,
    { revalidateOnFocus: false },
  );

  const rows = data?.rows ?? [];

  const toggleRaw = (id: string) => {
    setExpandedRawIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="-m-4 flex h-full flex-col">
      <StaleDataBanner
        headline="Showing cached prompt history - OpenCode is unreachable."
        hint="The archive is served from OpenPortal's local SQLite. Re-firing a prompt into a session will fail until OpenCode is back."
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="relative flex flex-1 items-center">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2 size-4 text-muted-fg" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search filtered text (FTS5)…"
            className="w-full rounded-md border border-border bg-bg px-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
          {(["tree", "flat"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setView(m)}
              className={`px-2 py-1 rounded-sm transition-colors ${
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
      </div>

      <div className="flex-1 overflow-auto px-2 py-2 sm:px-4">
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <Loader className="size-6" />
          </div>
        )}
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger-subtle/30 p-3 text-sm text-danger-subtle-fg">
            Failed to load: {error.message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-fg">
            <p>No prompts archived yet.</p>
            <p className="text-xs">
              Submissions to /prompt and /command capture into this archive
              starting from when this feature landed.
            </p>
          </div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <>
            {view === "flat" ? (
              <FlatList
                rows={rows}
                expandedRawIds={expandedRawIds}
                onToggleRaw={toggleRaw}
                onRefire={setRefireTargetId}
              />
            ) : (
              <TreeView
                rows={rows}
                focusSessionId={search.focus}
                searchActive={q.trim().length > 0}
                expandedRawIds={expandedRawIds}
                onToggleRaw={toggleRaw}
                onRefire={setRefireTargetId}
              />
            )}
            {data?.nextCursor !== null && data?.nextCursor !== undefined && (
              <div className="py-3 text-center text-xs text-muted-fg">
                Showing first {rows.length}; more rows exist. Refine the
                search or load more (TODO).
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
  expandedRawIds,
  onToggleRaw,
  onRefire,
}: {
  rows: PromptRow[];
  expandedRawIds: Set<string>;
  onToggleRaw: (id: string) => void;
  onRefire: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((row) => (
        <li key={row.id} className="py-2">
          <PromptRowItem
            row={row}
            showRaw={expandedRawIds.has(row.id)}
            onToggleRaw={() => onToggleRaw(row.id)}
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
  focusSessionId,
  searchActive,
  expandedRawIds,
  onToggleRaw,
  onRefire,
}: {
  rows: PromptRow[];
  focusSessionId: string | undefined;
  searchActive: boolean;
  expandedRawIds: Set<string>;
  onToggleRaw: (id: string) => void;
  onRefire: (id: string) => void;
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
  // starts from a clean overview.
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
                    <div key={sessionId}>
                      <button
                        type="button"
                        onClick={() => toggleSession(sessionId)}
                        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-muted/30"
                      >
                        <ChevronRightIcon
                          className={`size-3 shrink-0 transition-transform ${sessionCollapsed ? "" : "rotate-90"}`}
                        />
                        <span className="font-mono text-muted-fg">
                          {sessionId.slice(0, 16)}…
                        </span>
                        <span className="text-muted-fg">
                          ({sessionRows.length})
                        </span>
                      </button>
                      {!sessionCollapsed && (
                        <ul className="ml-3 divide-y divide-border/40 border-l border-border/30 pl-2">
                          {sessionRows.map((row) => (
                            <li key={row.id} className="py-2">
                              <PromptRowItem
                                row={row}
                                showRaw={expandedRawIds.has(row.id)}
                                onToggleRaw={() => onToggleRaw(row.id)}
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
  showRaw,
  onToggleRaw,
  onRefire,
  compact,
}: {
  row: PromptRow;
  showRaw: boolean;
  onToggleRaw: () => void;
  onRefire: () => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-fg">
        <span title={formatAbsoluteAndRelative(row.ts_ms)}>
          {formatRelativeTime(row.ts_ms)}
        </span>
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
      <div className="whitespace-pre-wrap break-words text-sm">
        {row.raw_text}
      </div>
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
        <button
          type="button"
          onClick={onToggleRaw}
          title={showRaw ? "Hide unfiltered" : "Show unfiltered"}
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs hover:bg-muted/30"
        >
          {showRaw ? (
            <>
              <EyeSlashIcon className="size-3" />
              Hide raw
            </>
          ) : (
            <>
              <EyeIcon className="size-3" />
              Show raw
            </>
          )}
        </button>
      </div>
      {showRaw && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border/40 bg-muted/20 p-2 text-xs">
          {row.raw_text_unfiltered}
        </pre>
      )}
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
