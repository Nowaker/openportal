import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  DocumentIcon,
  DocumentPlusIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
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

interface BrowseEntry {
  name: string;
  isDir: boolean;
  size?: number;
}

interface BrowseResponse {
  path?: string;
  parent?: string | null;
  home?: string;
  entries?: BrowseEntry[];
  virtual?: true;
  error?: string;
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
}

export const Route = createFileRoute("/files")({
  validateSearch: (search): FilesSearch => ({
    path: typeof search.path === "string" ? search.path : undefined,
    file: typeof search.file === "string" ? search.file : undefined,
    panel:
      search.panel === 1 || search.panel === "1" || search.panel === true
        ? 1
        : undefined,
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
    if (browse?.path) setPathInput(toTildeDisplay(browse.path, home));
  }, [browse?.path, home]);

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
        parent={browse?.parent ?? null}
        onRefresh={() => void mutateBrowse()}
        onGoBack={() => {
          if (window.history.length > 1) window.history.back();
        }}
        onGoHome={() => browse?.home && goTo(browse.home)}
        onGoUp={() => browse?.parent && goTo(browse.parent)}
        inPanel={search.panel === 1}
      />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="relative border-b border-border md:w-72 md:shrink-0 md:overflow-auto md:border-b-0 md:border-r">
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
                const next =
                  browse.path === "/"
                    ? `/${name}`
                    : `${browse.path}/${name}`;
                goTo(next);
              }}
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
            />
          )}
        </main>
      </div>
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
  inPanel,
}: {
  pathInput: string;
  onPathInputChange: (next: string) => void;
  onPathSubmit: () => void;
  entries: BrowseEntry[];
  home: string | undefined;
  parent: string | null;
  onRefresh: () => void;
  onGoBack: () => void;
  onGoHome: () => void;
  onGoUp: () => void;
  inPanel: boolean;
}) {
  const pathInputRef = useRef<PathInputHandle>(null);
  const closePanel = () => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "fb-close" }, "*");
    }
  };
  return (
    <header className="flex items-center gap-1.5 border-b border-border bg-bg px-3 py-2">
      <button
        type="button"
        onClick={onGoBack}
        title="Back (browser history)"
        className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
      >
        <ArrowLeftIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={onGoUp}
        disabled={!parent}
        data-test="portal-files-up"
        title="Parent directory"
        className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ArrowUpIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={onGoHome}
        disabled={!home}
        data-test="portal-files-home"
        title="Home directory"
        className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg disabled:opacity-30"
      >
        <HomeIcon className="size-4" />
      </button>
      <div className="flex-1 min-w-0">
        <PathInput
          ref={pathInputRef}
          value={pathInput}
          onChange={onPathInputChange}
          onSubmit={onPathSubmit}
          entries={entries}
          placeholder="path"
          data-test="portal-files-pathinput"
          className="w-full rounded-md border border-border bg-muted/20 px-2 py-1 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary sm:text-sm"
        />
      </div>
      <button
        type="button"
        onClick={onRefresh}
        data-test="portal-files-refresh"
        title="Refresh"
        className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
      >
        <ArrowPathIcon className="size-4" />
      </button>
      {inPanel && (
        <button
          type="button"
          onClick={closePanel}
          data-test="portal-files-close"
          title="Close file browser"
          aria-label="Close file browser"
          className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
        >
          <XMarkIcon className="size-4" />
        </button>
      )}
    </header>
  );
}

function formatBytes(n: number | undefined): string {
  if (typeof n !== "number") return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
}: {
  entries: BrowseEntry[];
  currentPath: string;
  selectedFile: string | undefined;
  onSelectDir: (name: string) => void;
  onSelectFile: (name: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: BrowseEntry;
  } | null>(null);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, entry: BrowseEntry) => {
    e.preventDefault();
    
    const menuWidth = 160;
    const menuHeight = 40;
    
    let x = e.clientX;
    let y = e.clientY;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }
    
    setContextMenu({ x, y, entry });
  };

  const handleCopyUrl = () => {
    if (!contextMenu) return;
    const { entry } = contextMenu;
    const url = new URL(window.location.origin + "/files");
    
    if (entry.isDir) {
      const nextPath = currentPath === "/" ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      url.searchParams.set("path", nextPath);
    } else {
      if (currentPath) {
        url.searchParams.set("path", currentPath);
      }
      url.searchParams.set("file", entry.name);
    }
    
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has("panel")) {
      url.searchParams.set("panel", currentUrl.searchParams.get("panel")!);
    }
    
    void navigator.clipboard.writeText(url.toString());
    toast.success("Link copied");
    setContextMenu(null);
  };

  return (
    <>
      <ul className="text-sm">
        {entries.map((e) => {
          const isSelected = !e.isDir && e.name === selectedFile;
          return (
            <li key={e.name}>
              <button
                type="button"
                onClick={() => (e.isDir ? onSelectDir(e.name) : onSelectFile(e.name))}
                onContextMenu={(ev) => handleContextMenu(ev, e)}
                data-test={`portal-files-entry-${e.name}`}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/30 ${
                  isSelected ? "bg-primary/10 text-primary" : ""
                }`}
                title={`${currentPath === "/" ? "" : currentPath}/${e.name}`}
              >
                {(() => {
                  const { Icon, color } = getFileIcon(e.name, e.isDir);
                  return <Icon className={`size-4 shrink-0 ${color}`} />;
                })()}
                <span className="truncate">{e.name}</span>
                {!e.isDir && typeof e.size === "number" && (
                  <span className="ml-auto shrink-0 text-xs text-muted-fg">
                    {formatBytes(e.size)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {entries.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-muted-fg">
            (empty directory)
          </li>
        )}
      </ul>
      
      {contextMenu && (
        <div
          className="fixed z-50 min-w-32 overflow-hidden rounded-md border border-border bg-bg p-1 shadow-md"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleCopyUrl}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-fg"
          >
            <ClipboardDocumentIcon className="size-4" />
            Copy URL
          </button>
        </div>
      )}
    </>
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
}: {
  file: FileResponse;
  currentDir: string;
  onResolveLink: (target: string) => void;
}) {
  const renderableKind = detectRenderableKind(
    file.filename ?? "",
    file.language,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("rendered");
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
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
  if (file.kind === "binary") {
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
              <div className="space-y-2">
                <p>Binary file ({formatBytes(file.size)}).</p>
                <p className="text-xs text-muted-fg/70">
                  Use Raw or Download in the header above.
                </p>
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

  const sourcePane = (
    <ShikiCodeBlock content={text} language={effectiveLanguage} />
  );

  return (
    <div className="flex h-full flex-col">
      <FileHeader
        filename={file.filename ?? ""}
        size={file.size}
        language={effectiveLanguage}
        onLanguageChange={(lang) => setLanguageOverride(lang)}
        renderableKind={renderableKind}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onCopy={onCopy}
        rawUrl={rawUrl}
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
        {onCopy && (
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


