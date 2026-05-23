import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  AtSymbolIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  DocumentIcon,
  DocumentPlusIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderIcon,
  FolderPlusIcon,
  HashtagIcon,
  HomeIcon,
  PencilSquareIcon,
  StarIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { MarkdownRenderer } from "@/lib/markdown-renderer";
import { Loader } from "@/components/ui/loader";
import { PathInput, type PathInputHandle } from "@/components/ui/path-input";
import { toast } from "@/components/ui/toast";
import {
  LANGUAGE_OPTIONS,
  ShikiCodeBlock,
  detectLanguageFromContent,
} from "@/components/code-block-shiki";
import { fromTildeDisplay, toTildeDisplay } from "@/lib/path-utils";
import { getFileIcon } from "@/lib/file-icons";
import { FileEditor } from "@/components/file-editor";
import {
  useFileHistoryStore,
  prioritizeForProject,
  isInProject,
  type FileHistoryEntry,
} from "@/stores/file-history-store";

interface BrowseEntry {
  name: string;
  isDir: boolean;
  size?: number;
  mtimeMs?: number;
}

interface BrowseResponse {
  path?: string;
  parent?: string | null;
  home?: string;
  entries?: BrowseEntry[];
  virtual?: true;
  error?: string;
  isFile?: true;
  filename?: string;
}

interface FileResponse {
  path?: string;
  filename?: string;
  size?: number;
  kind?: "text" | "binary" | "too_large";
  content?: string;
  language?: string;
  maxBytes?: number;
  error?: string;
}

interface FilesSearch {
  path?: string;
  file?: string;
  panel?: 1;
  project?: string;
}

export const Route = createFileRoute("/files")({
  validateSearch: (search): FilesSearch => ({
    path: typeof search.path === "string" ? search.path : undefined,
    file: typeof search.file === "string" ? search.file : undefined,
    panel:
      search.panel === 1 || search.panel === "1" || search.panel === true
        ? 1
        : undefined,
    project: typeof search.project === "string" ? search.project : undefined,
  }),
  component: FilesPage,
});

const FETCH_TIMEOUT_MS = 10_000;

const fetcher = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

function FilesPage() {
  const search = useSearch({ from: "/files" });
  const navigate = useNavigate();

  const browseUrl = `/api/fs/browse${search.path ? `?path=${encodeURIComponent(search.path)}` : ""}`;
  const {
    data: browse,
    mutate: mutateBrowse,
    isLoading: browseLoading,
    isValidating: browseValidating,
    error: browseError,
  } = useSWR<BrowseResponse>(browseUrl, fetcher);

  const fileFullPath =
    search.file && browse?.path
      ? `${browse.path === "/" ? "" : browse.path}/${search.file}`
      : null;
  const fileUrl = fileFullPath
    ? `/api/fs/read?path=${encodeURIComponent(fileFullPath)}`
    : null;
  const {
    data: file,
    isLoading: fileLoading,
    isValidating: fileValidating,
    error: fileError,
    mutate: mutateFile,
  } = useSWR<FileResponse>(fileUrl, fetcher);

  useEffect(() => {
    document.title = search.file
      ? `${search.file} - OpenPortal files`
      : "OpenPortal files";
  }, [search.file]);

  // When the files page is mounted as the iframe inside the side panel
  // (FileBrowserPanel passes ?panel=1 in the iframe src), report every
  // navigation back to the parent so the panel can update its store and
  // the URL hash. The parent listens for { type: "fb-nav", path, file }.
  useEffect(() => {
    if (search.panel && typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage(
        { type: "fb-nav", path: search.path, file: search.file },
        "*",
      );
    }
  }, [search.path, search.file, search.panel]);

  const goTo = (path: string, file?: string) => {
    void navigate({
      to: "/files",
      search: { path, file, panel: search.panel },
    });
  };

  const home = browse?.home ?? "";
  const [pathInput, setPathInput] = useState("");
  useEffect(() => {
    if (browse?.isFile && browse.path) {
      setPathInput(toTildeDisplay(browse.path, home));
    } else if (browse?.path) {
      const display = search.file
        ? `${browse.path === "/" ? "" : browse.path}/${search.file}`
        : browse.path;
      setPathInput(toTildeDisplay(display, home));
    }
  }, [browse?.path, browse?.isFile, search.file, home]);

  // Server-side detection: when the user pastes a FILE path into the
  // address bar (or arrives via a markdown link that put the filename
  // in ?path=), browse returns { isFile, parent, filename }. Auto-
  // navigate to the canonical ?path=<dir>&file=<name> URL so the
  // file viewer renders + the URL bar reflects the split.
  useEffect(() => {
    if (browse?.isFile && browse.parent && browse.filename) {
      void navigate({
        to: "/files",
        search: {
          path: browse.parent,
          file: browse.filename,
          panel: search.panel,
        },
        replace: true,
      });
    }
  }, [browse?.isFile, browse?.parent, browse?.filename, search.panel, navigate]);

  const submitPath = () => {
    const abs = fromTildeDisplay(pathInput, home);
    goTo(abs);
  };

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <TopBar
        pathInput={pathInput}
        onPathInputChange={setPathInput}
        onPathSubmit={submitPath}
        entries={browse?.entries ?? []}
        home={browse?.home}
        project={search.project}
        parent={browse?.parent ?? null}
        onRefresh={() => void mutateBrowse()}
        onGoBack={() => {
          if (window.history.length > 1) window.history.back();
        }}
        onGoHome={() => browse?.home && goTo(browse.home)}
        onGoProject={() => search.project && goTo(search.project)}
        onGoUp={() => browse?.parent && goTo(browse.parent)}
        onGoTo={(p) => goTo(p)}
        inPanel={search.panel === 1}
      />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="relative max-h-[50vh] overflow-y-auto overscroll-contain border-b border-border md:h-full md:max-h-none md:w-72 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
          {browse?.entries && browse?.path && (
            <NewEntryToolbar
              currentPath={browse.path}
              onCreated={(kind, name) => {
                void mutateBrowse();
                if (kind === "file") goTo(browse.path ?? "", name);
              }}
            />
          )}
          {browseValidating && (
            <div className="absolute right-2 top-2 z-10 rounded-md border border-border bg-bg/95 p-1 shadow-sm">
              <Loader className="size-3.5" />
            </div>
          )}
          {browseLoading && !browse && (
            <div className="flex items-center justify-center p-6">
              <Loader className="size-5" />
            </div>
          )}
          {browseError && !browse && (
            <div className="m-2 space-y-2 rounded border border-danger/40 bg-danger-subtle/30 p-3 text-xs text-danger-subtle-fg">
              <p>{browseError.message || "Failed to load directory."}</p>
              <button
                type="button"
                onClick={() => void mutateBrowse()}
                className="rounded border border-border bg-bg px-2 py-1 text-fg hover:bg-muted"
                data-test="portal-files-retry-browse"
              >
                Retry
              </button>
            </div>
          )}
          {browse?.error && (
            <div className="m-2 rounded border border-danger/40 bg-danger-subtle/30 p-2 text-xs text-danger-subtle-fg">
              {browse.error}
            </div>
          )}
          {browse?.entries && (
            <FileTree
              entries={browse.entries}
              currentPath={browse.path ?? ""}
              selectedFile={search.file}
              onSelectDir={(name) => {
                if (name === ".." && browse.parent) {
                  goTo(browse.parent);
                  return;
                }
                const next =
                  browse.path === "/"
                    ? `/${name}`
                    : `${browse.path}/${name}`;
                goTo(next);
              }}
              parent={browse.parent}
              onSelectFile={(name) => goTo(browse.path ?? "", name)}
            />
          )}
        </aside>
        <main className="relative min-h-0 flex-1 overflow-auto">
          {search.file && fileValidating && file && (
            <div className="absolute right-3 top-3 z-10 rounded-md border border-border bg-bg/95 p-1 shadow-sm">
              <Loader className="size-3.5" />
            </div>
          )}
          {!search.file && (
            <div className="flex h-full items-center justify-center text-sm text-muted-fg">
              Pick a file from the list.
            </div>
          )}
          {search.file && fileLoading && !file && (
            <div className="flex h-full items-center justify-center">
              <Loader className="size-5" />
            </div>
          )}
          {search.file && fileError && !file && (
            <div className="m-4 space-y-2 rounded border border-danger/40 bg-danger-subtle/30 p-3 text-sm text-danger-subtle-fg">
              <p>{fileError.message || "Failed to load file."}</p>
              <button
                type="button"
                onClick={() => void mutateFile()}
                className="rounded border border-border bg-bg px-2 py-1 text-fg hover:bg-muted"
                data-test="portal-files-retry-file"
              >
                Retry
              </button>
            </div>
          )}
          {search.file && file && (
            <FileViewer
              file={file}
              currentDir={browse?.path ?? ""}
              onResolveLink={(target) => {
                const resolved = resolveLinkInDir(browse?.path ?? "", target);
                if (resolved) goTo(resolved.dir, resolved.file);
              }}
              onFileSaved={() => {
                void mutateFile();
                toast.success("Saved");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function HistoryDropdown({
  kind,
  project,
  onSelect,
}: {
  kind: "recent" | "mentions" | "bookmarks";
  project: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const max = useFileHistoryStore((s) => s.maxDisplay);
  const recent = useFileHistoryStore((s) => s.recentlyOpened);
  const bookmarks = useFileHistoryStore((s) => s.bookmarks);
  const removeBookmark = useFileHistoryStore((s) => s.removeBookmark);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const config = {
    recent: {
      label: "Recently opened",
      icon: ClockIcon,
      entries: recent,
      empty: "No recent files yet.",
      notImplemented: false,
    },
    mentions: {
      label: "Recently mentioned",
      icon: AtSymbolIcon,
      entries: [] as FileHistoryEntry[],
      empty: "Recently mentioned files - not implemented yet.",
      notImplemented: true,
    },
    bookmarks: {
      label: "Bookmarks",
      icon: StarIcon,
      entries: bookmarks,
      empty: "No bookmarks yet.",
      notImplemented: false,
    },
  }[kind];

  const displayed = prioritizeForProject(config.entries, project, max);
  const inProjectCount = displayed.filter((e) =>
    isInProject(e, project),
  ).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={config.label}
        aria-label={config.label}
        aria-expanded={open}
        className="inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
        data-test={`portal-files-history-${kind}`}
      >
        <config.icon className="size-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-bg shadow-xl">
          <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-fg">
            {config.label}
          </div>
          {config.notImplemented ? (
            <div className="px-3 py-3 text-xs text-muted-fg italic">
              {config.empty}
            </div>
          ) : displayed.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-fg italic">
              {config.empty}
            </div>
          ) : (
            <ul className="text-xs">
              {displayed.map((entry, idx) => {
                const showSeparator =
                  idx === inProjectCount && idx > 0 && project;
                return (
                  <li key={entry.path}>
                    {showSeparator && (
                      <div className="border-t border-border/60 my-1 mx-3" />
                    )}
                    <div className="flex items-center gap-1.5 px-2 hover:bg-muted/30">
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(entry.path);
                          setOpen(false);
                        }}
                        title={entry.path}
                        className="flex-1 min-w-0 truncate py-1.5 text-left"
                      >
                        {entry.isDir ? (
                          <FolderIcon className="inline size-3 mr-1.5 align-text-bottom text-amber-500/80" />
                        ) : (
                          <DocumentIcon className="inline size-3 mr-1.5 align-text-bottom text-muted-fg" />
                        )}
                        {entry.path.split("/").pop() || entry.path}
                      </button>
                      {kind === "bookmarks" && (
                        <button
                          type="button"
                          onClick={() => removeBookmark(entry.path)}
                          title="Remove bookmark"
                          aria-label={`Remove bookmark ${entry.path}`}
                          className="shrink-0 text-muted-fg/60 hover:text-danger"
                        >
                          <XMarkIcon className="size-3" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TopBar({
  pathInput,
  onPathInputChange,
  onPathSubmit,
  entries,
  home,
  parent,
  onRefresh,
  onGoBack,
  onGoHome,
  onGoUp,
  onGoTo,
  inPanel,
  project,
  onGoProject,
}: {
  pathInput: string;
  onPathInputChange: (next: string) => void;
  onPathSubmit: () => void;
  entries: BrowseEntry[];
  home: string | undefined;
  project: string | undefined;
  parent: string | null;
  onRefresh: () => void;
  onGoBack: () => void;
  onGoHome: () => void;
  onGoProject: () => void;
  onGoUp: () => void;
  onGoTo: (path: string) => void;
  inPanel: boolean;
}) {
  const pathInputRef = useRef<PathInputHandle>(null);
  // Close-panel-or-window. In iframe mode (inPanel), the parent
  // listens for postMessage. As a top-level tab, try window.close()
  // (works if the tab was opened by window.open from another tab);
  // otherwise fall back to history.back(), and finally home.
  const handleClose = () => {
    if (typeof window === "undefined") return;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "fb-close" }, "*");
      return;
    }
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = "/";
  };
  void inPanel;
  return (
    <header className="flex items-center gap-1 border-b border-border bg-bg px-2 py-2">
      <button
        type="button"
        onClick={onGoBack}
        title="Back (browser history)"
        className="inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
      >
        <ArrowLeftIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={onGoUp}
        disabled={!parent}
        data-test="portal-files-up"
        title="Parent directory"
        className="inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ArrowUpIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRefresh}
        data-test="portal-files-refresh"
        title="Refresh"
        className="inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
      >
        <ArrowPathIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={onGoHome}
        disabled={!home}
        data-test="portal-files-home"
        title={`Root${home ? ` (${home})` : ""}`}
        aria-label="Root"
        className="inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg disabled:opacity-30"
      >
        <HashtagIcon className="size-4" />
      </button>
      {project && (
        <button
          type="button"
          onClick={onGoProject}
          data-test="portal-files-project"
          title={`Project directory (${project})`}
          className="inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
        >
          <HomeIcon className="size-4" />
        </button>
      )}
      <HistoryDropdown
        kind="recent"
        project={project ?? null}
        onSelect={onGoTo}
      />
      <HistoryDropdown
        kind="mentions"
        project={project ?? null}
        onSelect={onGoTo}
      />
      <HistoryDropdown
        kind="bookmarks"
        project={project ?? null}
        onSelect={onGoTo}
      />
      <div className="flex-1 min-w-0">
        <PathInput
          ref={pathInputRef}
          value={pathInput}
          onChange={onPathInputChange}
          onSubmit={onPathSubmit}
          entries={entries}
          placeholder="path"
          data-test="portal-files-pathinput"
          className="w-full rounded-md border border-border bg-muted/20 px-2 py-1 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary sm:text-sm"
        />
      </div>
      <button
        type="button"
        onClick={handleClose}
        data-test="portal-files-close"
        title="Close file browser"
        aria-label="Close file browser"
        className="inline-flex size-6 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
      >
        <XMarkIcon className="size-4" />
      </button>
    </header>
  );
}

function formatBytes(n: number | undefined): string {
  if (typeof n !== "number") return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Aggressive short formatting per user spec: 'short numbers; bump
// units higher aggressively; precision isn't needed, short value is.'
// Targets a 2-3 character glanceable column ('30s', '5m', '2h', '3d',
// '4w', '6mo', '1y'). Units escalate at boundaries that match human
// intuition (60s -> 1m, 24h -> 1d, 7d -> 1w, 30d -> 1mo, 365d -> 1y).
function formatAge(mtimeMs: number | undefined): string {
  if (typeof mtimeMs !== "number") return "";
  const deltaMs = Date.now() - mtimeMs;
  if (deltaMs < 0) return "0s";
  const s = Math.floor(deltaMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (d < 30) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (d < 365) return `${mo}mo`;
  const y = Math.floor(d / 365);
  return `${y}y`;
}

function NewEntryToolbar({
  currentPath,
  onCreated,
}: {
  currentPath: string;
  onCreated: (kind: "dir" | "file", name: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "dir" | "file">("idle");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDir = () => {
    setMode("dir");
    setName("Untitled folder");
    setError(null);
  };
  const startFile = () => {
    setMode("file");
    setName("Untitled.txt");
    setError(null);
  };
  const cancel = () => {
    setMode("idle");
    setName("");
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Name cannot be empty.");
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\0")) {
      setError("Name cannot contain slashes or null bytes.");
      return;
    }
    const sep = currentPath.endsWith("/") ? "" : "/";
    const path = `${currentPath}${sep}${trimmed}`;
    const endpoint = mode === "dir" ? "/api/fs/mkdir" : "/api/fs/touch";
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      const kind = mode === "dir" ? "dir" : "file";
      cancel();
      onCreated(kind, trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "idle") {
    return (
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-xs">
        <button
          type="button"
          onClick={startDir}
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-1 hover:bg-muted/40"
          data-test="portal-files-newfolder"
          title="New folder in this directory"
        >
          <FolderPlusIcon className="size-3.5" />
          New folder
        </button>
        <button
          type="button"
          onClick={startFile}
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-1 hover:bg-muted/40"
          data-test="portal-files-newfile"
          title="New file in this directory"
        >
          <DocumentPlusIcon className="size-3.5" />
          New file
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-border px-2 py-1.5 space-y-1.5">
      <div className="flex items-center gap-1 text-xs">
        {mode === "dir" ? (
          <FolderPlusIcon className="size-3.5 shrink-0 text-muted-fg" />
        ) : (
          <DocumentPlusIcon className="size-3.5 shrink-0 text-muted-fg" />
        )}
        <input
          type="text"
          value={name}
          autoFocus
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="flex-1 min-w-0 rounded border border-border bg-bg px-1.5 py-1 text-xs focus:border-primary focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          aria-label="Create"
          className="rounded border border-primary/40 bg-primary/10 p-1 text-primary hover:bg-primary/20 disabled:opacity-50"
          data-test="portal-files-new-submit"
        >
          <CheckIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          aria-label="Cancel"
          className="rounded border border-border bg-bg p-1 text-muted-fg hover:bg-muted/40 disabled:opacity-50"
          data-test="portal-files-new-cancel"
        >
          <XMarkIcon className="size-3.5" />
        </button>
      </div>
      {error && (
        <div className="text-xs text-danger-subtle-fg">{error}</div>
      )}
    </div>
  );
}

function FileTree({
  entries,
  currentPath,
  selectedFile,
  onSelectDir,
  onSelectFile,
  parent,
}: {
  entries: BrowseEntry[];
  currentPath: string;
  selectedFile: string | undefined;
  onSelectDir: (name: string) => void;
  onSelectFile: (name: string) => void;
  parent: string | null;
}) {
  // Synthetic '..' entry rendered as the first row when the current
  // directory isn't the user-visible root. Clicking it routes back
  // to `parent` (which the server computed against the configured
  // base directories, so it can't escape the scope).
  const allEntries = parent
    ? [{ name: "..", isDir: true, size: undefined } as BrowseEntry, ...entries]
    : entries;
  // Build a regular SPA URL for each entry so the tree can be a real
  // <a href> tree. Native long-press on mobile + middle-click /
  // cmd-click / ctrl-click on desktop now work without any custom
  // popup: the browser's own link menu surfaces "Copy link", "Open in
  // new tab", "Save link", etc.
  const buildEntryHref = (entry: BrowseEntry): string => {
    const url = new URL(window.location.origin + "/files");
    if (entry.name === ".." && parent) {
      url.searchParams.set("path", parent);
    } else if (entry.isDir) {
      const nextPath =
        currentPath === "/"
          ? `/${entry.name}`
          : `${currentPath}/${entry.name}`;
      url.searchParams.set("path", nextPath);
    } else {
      if (currentPath) {
        url.searchParams.set("path", currentPath);
      }
      url.searchParams.set("file", entry.name);
    }
    if (typeof window !== "undefined") {
      const currentUrl = new URL(window.location.href);
      for (const k of ["panel", "project"]) {
        const v = currentUrl.searchParams.get(k);
        if (v !== null) url.searchParams.set(k, v);
      }
    }
    return url.pathname + url.search;
  };

  return (
    <ul className="text-sm">
      {allEntries.map((e) => {
        const isSelected = !e.isDir && e.name === selectedFile;
        return (
          <li key={e.name}>
            <a
              href={buildEntryHref(e)}
              onClick={(ev) => {
                if (
                  ev.button !== 0 ||
                  ev.metaKey ||
                  ev.ctrlKey ||
                  ev.shiftKey ||
                  ev.altKey
                ) {
                  return;
                }
                ev.preventDefault();
                if (e.isDir) onSelectDir(e.name);
                else onSelectFile(e.name);
              }}
              data-test={`portal-files-entry-${e.name}`}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg no-underline transition-colors hover:bg-muted/30 ${
                isSelected ? "bg-primary/10 text-primary" : ""
              }`}
              title={`${currentPath === "/" ? "" : currentPath}/${e.name}`}
            >
              {(() => {
                const { Icon, color } = getFileIcon(e.name, e.isDir);
                return <Icon className={`size-4 shrink-0 ${color}`} />;
              })()}
              <span className="truncate flex-1 min-w-0">{e.name}</span>
              {!e.isDir && typeof e.size === "number" && (
                <span className="shrink-0 text-xs text-muted-fg tabular-nums w-14 text-right">
                  {formatBytes(e.size)}
                </span>
              )}
              {e.isDir && <span className="shrink-0 w-14" />}
              {typeof e.mtimeMs === "number" && (
                <span
                  className="shrink-0 text-xs text-muted-fg tabular-nums w-10 text-right"
                  title={new Date(e.mtimeMs).toLocaleString()}
                >
                  {formatAge(e.mtimeMs)}
                </span>
              )}
            </a>
          </li>
        );
      })}
      {entries.length === 0 && (
        <li className="px-3 py-4 text-center text-xs text-muted-fg">
          (empty directory)
        </li>
      )}
    </ul>
  );
}

function resolveLinkInDir(
  currentDir: string,
  link: string,
): { dir: string; file?: string } | null {
  if (link.startsWith("http://") || link.startsWith("https://") || link.startsWith("//")) {
    return null;
  }
  let target: string;
  if (link.startsWith("/")) {
    target = link;
  } else {
    const base = currentDir === "/" ? "" : currentDir;
    target = `${base}/${link}`;
  }
  // Resolve '..' and '.' segments without re-canonicalizing through the
  // server. The server will validate scope before any read; this is
  // just for URL construction.
  const parts = target.split("/").filter((p) => p.length > 0);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  const full = "/" + resolved.join("/");
  const slash = full.lastIndexOf("/");
  if (slash <= 0) return { dir: full };
  return { dir: full.slice(0, slash), file: full.slice(slash + 1) };
}

type ViewMode = "rendered" | "source" | "split";

function detectRenderableKind(
  filename: string,
  language: string | undefined,
): "markdown" | "html" | null {
  const lower = filename.toLowerCase();
  if (
    language === "markdown" ||
    lower.endsWith(".md") ||
    lower.endsWith(".mdx") ||
    lower.endsWith(".markdown")
  ) {
    return "markdown";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) {
    return "html";
  }
  return null;
}

function FileViewer({
  file,
  currentDir,
  onResolveLink,
  onFileSaved,
}: {
  file: FileResponse;
  currentDir: string;
  onResolveLink: (target: string) => void;
  onFileSaved?: () => void;
}) {
  const renderableKind = detectRenderableKind(
    file.filename ?? "",
    file.language,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("rendered");
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [forceShowBinaryAsText, setForceShowBinaryAsText] = useState(false);
  const editable =
    file.kind === "text" &&
    typeof file.path === "string" &&
    file.path.length > 0;
  useEffect(() => {
    setIsEditing(false);
    setSaving(false);
    setForceShowBinaryAsText(false);
    if (typeof file.path === "string" && file.path.length > 0) {
      useFileHistoryStore
        .getState()
        .recordOpened(file.path, file.kind === "directory");
    }
  }, [file.path, file.kind]);
  const startEdit = () => {
    setEditedText(file.content ?? "");
    setIsEditing(true);
  };
  const cancelEdit = () => {
    setIsEditing(false);
    setEditedText("");
  };
  const saveEdit = async () => {
    if (!editable) return;
    setSaving(true);
    try {
      const r = await fetch("/api/fs/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: editedText }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          body?.error ?? `Save failed (HTTP ${r.status})`,
        );
      }
      setIsEditing(false);
      setEditedText("");
      onFileSaved?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Save failed";
      window.alert(message);
    } finally {
      setSaving(false);
    }
  };
  const detectedLanguage = useMemo(() => {
    const serverLang = file.language ?? "text";
    if (serverLang !== "text") return serverLang;
    if (file.kind !== "text" || !file.content) return "text";
    return detectLanguageFromContent(file.content, file.filename);
  }, [file.language, file.content, file.kind, file.filename]);
  const effectiveLanguage = languageOverride ?? detectedLanguage;
  useEffect(() => {
    setViewMode(renderableKind ? "rendered" : "source");
    setLanguageOverride(null);
  }, [file.filename, renderableKind]);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const syncScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const denom = source.scrollHeight - source.clientHeight;
    if (denom > 0) {
      const ratio = source.scrollTop / denom;
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  if (file.error) {
    return (
      <div className="m-4 rounded border border-danger/40 bg-danger-subtle/30 p-3 text-sm text-danger-subtle-fg">
        {file.error}
      </div>
    );
  }
  if (file.kind === "too_large") {
    const filename = file.filename ?? "";
    const rawUrl = `/api/fs/raw?path=${encodeURIComponent(file.path ?? "")}`;
    return (
      <div className="flex h-full flex-col">
        <FileHeader
          filename={filename}
          size={file.size}
          language={file.language ?? "text"}
          onLanguageChange={null}
          renderableKind={null}
          viewMode="source"
          setViewMode={() => {}}
          onCopy={null}
          rawUrl={rawUrl}
        />
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-fg">
          <div className="space-y-2">
            <p>File too large to render in-page.</p>
            <p className="text-xs">
              {formatBytes(file.size)} (cap{" "}
              {typeof file.maxBytes === "number"
                ? formatBytes(file.maxBytes)
                : "?"}
              )
            </p>
            <p className="text-xs text-muted-fg/70">
              Use Raw or Download in the header above.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (file.kind === "binary" && !forceShowBinaryAsText) {
    const filename = file.filename ?? "";
    const isImage = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(filename);
    const rawUrl = `/api/fs/raw?path=${encodeURIComponent(file.path ?? "")}`;
    return (
      <div className="flex h-full flex-col">
        <FileHeader
          filename={filename}
          size={file.size}
          language="binary"
          onLanguageChange={null}
          renderableKind={null}
          viewMode="source"
          setViewMode={() => {}}
          onCopy={null}
          rawUrl={rawUrl}
        />
        <div className="flex-1 overflow-auto p-4">
          {isImage ? (
            <img
              src={rawUrl}
              alt={filename}
              className="mx-auto max-h-full max-w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-fg">
              <div className="space-y-3">
                <p>Binary file ({formatBytes(file.size)}).</p>
                <button
                  type="button"
                  onClick={() => setForceShowBinaryAsText(true)}
                  data-test="portal-files-show-as-text"
                  className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs hover:bg-muted/30"
                >
                  Show as text anyway
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const text = file.content ?? "";
  const onCopy = () => {
    void navigator.clipboard.writeText(text);
    toast.success("Copied plaintext");
  };
  const rawUrl = `/api/fs/raw?path=${encodeURIComponent(file.path ?? "")}`;

  const renderedPane = renderableKind === "markdown"
    ? (
      <div className="prose prose-sm dark:prose-invert max-w-none p-4 break-words [&_pre]:overflow-x-auto">
        <MarkdownRenderer
          source={text}
          mode="extended"
          components={{
            a: ({ href, children, ...rest }) => {
              if (!href) return <a {...rest}>{children}</a>;
              if (
                href.startsWith("http://") ||
                href.startsWith("https://") ||
                href.startsWith("mailto:") ||
                href.startsWith("#")
              ) {
                return (
                  <a href={href} target="_blank" rel="noreferrer" {...rest}>
                    {children}
                  </a>
                );
              }
              return (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onResolveLink(href);
                  }}
                  {...rest}
                >
                  {children}
                </a>
              );
            },
          }}
        />
      </div>
    )
    : renderableKind === "html"
      ? (
        <iframe
          title={file.filename ?? "html preview"}
          srcDoc={text}
          sandbox=""
          className="h-full w-full border-0 bg-white"
        />
      )
      : null;

  const sourcePane = isEditing ? (
    <FileEditor
      value={editedText}
      onChange={setEditedText}
      onSave={() => void saveEdit()}
      wordWrap={true}
    />
  ) : (
    <ShikiCodeBlock content={text} language={effectiveLanguage} />
  );

  return (
    <div className="flex h-full flex-col">
      <FileHeader
        filename={file.filename ?? ""}
        size={file.size}
        language={effectiveLanguage}
        onLanguageChange={isEditing ? null : (lang) => setLanguageOverride(lang)}
        renderableKind={isEditing ? null : renderableKind}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onCopy={isEditing ? null : onCopy}
        rawUrl={rawUrl}
        editable={editable}
        isEditing={isEditing}
        isSaving={saving}
        onStartEdit={startEdit}
        onSave={() => void saveEdit()}
        onCancel={cancelEdit}
        filePath={file.path}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderableKind && viewMode === "rendered" && (
          <div className="h-full overflow-auto">{renderedPane}</div>
        )}
        {(!renderableKind || viewMode === "source") && (
          <div className="h-full overflow-auto">{sourcePane}</div>
        )}
        {renderableKind && viewMode === "split" && (
          <div className="flex h-full">
            <div
              ref={leftRef}
              onScroll={() => {
                if (leftRef.current && rightRef.current) {
                  syncScroll(leftRef.current, rightRef.current);
                }
              }}
              className="flex-1 overflow-auto border-r border-border"
            >
              {renderedPane}
            </div>
            <div
              ref={rightRef}
              onScroll={() => {
                if (leftRef.current && rightRef.current) {
                  syncScroll(rightRef.current, leftRef.current);
                }
              }}
              className="flex-1 overflow-auto"
            >
              {sourcePane}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileHeader({
  filename,
  size,
  language,
  onLanguageChange,
  renderableKind,
  viewMode,
  setViewMode,
  onCopy,
  rawUrl,
  editable = false,
  isEditing = false,
  isSaving = false,
  onStartEdit,
  onSave,
  onCancel,
  filePath,
}: {
  filename: string;
  size: number | undefined;
  language: string;
  onLanguageChange: ((lang: string) => void) | null;
  renderableKind: "markdown" | "html" | null;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  onCopy: (() => void) | null;
  rawUrl: string;
  editable?: boolean;
  isEditing?: boolean;
  isSaving?: boolean;
  onStartEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  filePath?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
      <span className="truncate text-sm font-medium">{filename}</span>
      {onLanguageChange ? (
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          title="Syntax highlighting language"
          className="rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-muted-fg hover:text-fg focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {LANGUAGE_OPTIONS.find((l) => l.id === language) === undefined && (
            <option value={language}>{language}</option>
          )}
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-muted-fg">{language}</span>
      )}
      {typeof size === "number" && (
        <span className="text-muted-fg">{formatBytes(size)}</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {renderableKind && (
          <div className="inline-flex rounded border border-border bg-bg p-0.5">
            <ViewModeButton
              active={viewMode === "rendered"}
              onClick={() => setViewMode("rendered")}
              title="Rendered view"
            >
              <EyeIcon className="size-3" />
              <span className="hidden sm:inline">Rendered</span>
            </ViewModeButton>
            <ViewModeButton
              active={viewMode === "source"}
              onClick={() => setViewMode("source")}
              title="Source view"
            >
              <EyeSlashIcon className="size-3" />
              <span className="hidden sm:inline">Source</span>
            </ViewModeButton>
            <ViewModeButton
              active={viewMode === "split"}
              onClick={() => setViewMode("split")}
              title="Side by side (desktop)"
              className="hidden md:inline-flex"
            >
              <span className="font-mono">⫶⫶</span>
              <span className="hidden sm:inline">Split</span>
            </ViewModeButton>
          </div>
        )}
        {!isEditing && filePath && (
          <BookmarkButton path={filePath} isDir={false} />
        )}
        {!isEditing && onCopy && (
          <button
            type="button"
            onClick={onCopy}
            data-test="portal-files-copy"
            className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30"
          >
            <ClipboardDocumentIcon className="size-3" />
            Copy
          </button>
        )}
        {!isEditing && editable && onStartEdit && (
          <button
            type="button"
            onClick={onStartEdit}
            data-test="portal-files-edit"
            title="Edit file in place"
            className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30"
          >
            <PencilSquareIcon className="size-3" />
            Edit
          </button>
        )}
        {isEditing && (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              data-test="portal-files-save"
              title="Save file (writes to disk, sandboxed)"
              className="inline-flex items-center gap-1 rounded border border-primary bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              <CheckIcon className="size-3" />
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              data-test="portal-files-cancel"
              className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30 disabled:opacity-50"
            >
              <XMarkIcon className="size-3" />
              Cancel
            </button>
          </>
        )}
        <a
          href={rawUrl}
          target="_blank"
          rel="noreferrer"
          data-test="portal-files-raw"
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30"
          title="Open raw file in a new tab"
        >
          <ArrowTopRightOnSquareIcon className="size-3" />
          Raw
        </a>
        <a
          href={`${rawUrl}&download=1`}
          data-test="portal-files-download"
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30"
          title="Download file"
        >
          <ArrowDownTrayIcon className="size-3" />
          Download
        </a>
      </div>
    </div>
  );
}

function BookmarkButton({ path, isDir }: { path: string; isDir: boolean }) {
  const bookmarks = useFileHistoryStore((s) => s.bookmarks);
  const toggle = useFileHistoryStore((s) => s.toggleBookmark);
  const isBookmarked = bookmarks.some((b) => b.path === path);
  const Icon = isBookmarked ? StarIconSolid : StarIcon;
  return (
    <button
      type="button"
      onClick={() => toggle(path, isDir)}
      aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
      title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
      data-test="portal-files-bookmark"
      className={`inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30 ${
        isBookmarked ? "text-amber-500" : ""
      }`}
    >
      <Icon className="size-3" />
    </button>
  );
}

function ViewModeButton({
  active,
  onClick,
  title,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
        active ? "bg-primary/10 text-primary" : "text-muted-fg hover:bg-muted/30"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}


