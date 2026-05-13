import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  ClipboardDocumentIcon,
  DocumentIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderIcon,
  HomeIcon,
} from "@heroicons/react/24/outline";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import useSWR from "swr";

import { MarkdownRenderer } from "@/lib/markdown-renderer";
import { Loader } from "@/components/ui/loader";
import { PathInput, type PathInputHandle } from "@/components/ui/path-input";
import { toast } from "@/components/ui/toast";
import { fromTildeDisplay, toTildeDisplay } from "@/lib/path-utils";

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
}

export const Route = createFileRoute("/files")({
  validateSearch: (search): FilesSearch => ({
    path: typeof search.path === "string" ? search.path : undefined,
    file: typeof search.file === "string" ? search.file : undefined,
  }),
  component: FilesPage,
});

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function FilesPage() {
  const search = useSearch({ from: "/files" });
  const navigate = useNavigate();

  const browseUrl = `/api/fs/browse${search.path ? `?path=${encodeURIComponent(search.path)}` : ""}`;
  const { data: browse, mutate: mutateBrowse, isLoading: browseLoading } =
    useSWR<BrowseResponse>(browseUrl, fetcher);

  const fileFullPath =
    search.file && browse?.path
      ? `${browse.path === "/" ? "" : browse.path}/${search.file}`
      : null;
  const fileUrl = fileFullPath
    ? `/api/fs/read?path=${encodeURIComponent(fileFullPath)}`
    : null;
  const { data: file, isLoading: fileLoading } = useSWR<FileResponse>(
    fileUrl,
    fetcher,
  );

  useEffect(() => {
    document.title = search.file
      ? `${search.file} - openportal files`
      : "openportal files";
  }, [search.file]);

  const goTo = (path: string, file?: string) => {
    void navigate({
      to: "/files",
      search: { path, file },
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
      />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="border-b border-border md:w-72 md:shrink-0 md:overflow-auto md:border-b-0 md:border-r">
          {browseLoading && !browse && (
            <div className="flex items-center justify-center p-6">
              <Loader className="size-5" />
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
        <main className="min-h-0 flex-1 overflow-auto">
          {!search.file && (
            <div className="flex h-full items-center justify-center text-sm text-muted-fg">
              Pick a file from the list.
            </div>
          )}
          {search.file && fileLoading && (
            <div className="flex h-full items-center justify-center">
              <Loader className="size-5" />
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
}) {
  const pathInputRef = useRef<PathInputHandle>(null);
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
        title="Parent directory"
        className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ArrowUpIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={onGoHome}
        disabled={!home}
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
          className="w-full rounded-md border border-border bg-muted/20 px-2 py-1 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary sm:text-sm"
        />
      </div>
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh"
        className="inline-flex size-7 items-center justify-center rounded text-muted-fg hover:bg-muted/30 hover:text-fg"
      >
        <ArrowPathIcon className="size-4" />
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
  return (
    <ul className="text-sm">
      {entries.map((e) => {
        const isSelected = !e.isDir && e.name === selectedFile;
        return (
          <li key={e.name}>
            <button
              type="button"
              onClick={() => (e.isDir ? onSelectDir(e.name) : onSelectFile(e.name))}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/30 ${
                isSelected ? "bg-primary/10 text-primary" : ""
              }`}
              title={`${currentPath === "/" ? "" : currentPath}/${e.name}`}
            >
              {e.isDir ? (
                <FolderIcon className="size-4 shrink-0 text-amber-500" />
              ) : (
                <DocumentIcon className="size-4 shrink-0 text-muted-fg" />
              )}
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

function FileViewer({
  file,
  currentDir,
  onResolveLink,
}: {
  file: FileResponse;
  currentDir: string;
  onResolveLink: (target: string) => void;
}) {
  const [renderMarkdown, setRenderMarkdown] = useState(true);

  if (file.error) {
    return (
      <div className="m-4 rounded border border-danger/40 bg-danger-subtle/30 p-3 text-sm text-danger-subtle-fg">
        {file.error}
      </div>
    );
  }
  if (file.kind === "too_large") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-fg">
        <p>File too large to render in-page ({formatBytes(file.size)}).</p>
        <a
          href={`/api/fs/raw?path=${encodeURIComponent(file.path ?? "")}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <ArrowTopRightOnSquareIcon className="size-4" />
          Open raw
        </a>
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
          showRawToggle={false}
          renderMarkdown={false}
          setRenderMarkdown={() => {}}
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
            <div className="text-sm text-muted-fg">
              Binary file ({formatBytes(file.size)}). Use the download link.
            </div>
          )}
        </div>
      </div>
    );
  }

  const isMarkdown = file.language === "markdown";
  const text = file.content ?? "";
  const onCopy = () => {
    void navigator.clipboard.writeText(text);
    toast.success("Copied plaintext");
  };
  const rawUrl = `/api/fs/raw?path=${encodeURIComponent(file.path ?? "")}`;

  return (
    <div className="flex h-full flex-col">
      <FileHeader
        filename={file.filename ?? ""}
        size={file.size}
        language={file.language ?? "text"}
        showRawToggle={isMarkdown}
        renderMarkdown={renderMarkdown}
        setRenderMarkdown={setRenderMarkdown}
        onCopy={onCopy}
        rawUrl={rawUrl}
      />
      <div className="flex-1 overflow-auto">
        {isMarkdown && renderMarkdown ? (
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
        ) : (
          <CodeBlock content={text} language={file.language ?? "text"} />
        )}
      </div>
    </div>
  );
}

function FileHeader({
  filename,
  size,
  language,
  showRawToggle,
  renderMarkdown,
  setRenderMarkdown,
  onCopy,
  rawUrl,
}: {
  filename: string;
  size: number | undefined;
  language: string;
  showRawToggle: boolean;
  renderMarkdown: boolean;
  setRenderMarkdown: (v: boolean) => void;
  onCopy: (() => void) | null;
  rawUrl: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
      <span className="truncate font-mono text-sm font-medium">{filename}</span>
      <span className="text-muted-fg">{language}</span>
      {typeof size === "number" && (
        <span className="text-muted-fg">{formatBytes(size)}</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {showRawToggle && (
          <button
            type="button"
            onClick={() => setRenderMarkdown(!renderMarkdown)}
            className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30"
          >
            {renderMarkdown ? (
              <>
                <EyeSlashIcon className="size-3" />
                Raw
              </>
            ) : (
              <>
                <EyeIcon className="size-3" />
                Render
              </>
            )}
          </button>
        )}
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
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
          className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 hover:bg-muted/30"
          title="Open raw file in a new tab"
        >
          <ArrowTopRightOnSquareIcon className="size-3" />
          Raw
        </a>
      </div>
    </div>
  );
}

function CodeBlock({ content, language }: { content: string; language: string }) {
  // Cap the highlighter input. prism-react-renderer tokenizes the entire
  // string up-front; multi-megabyte files (already capped at 5 MB server
  // -side) make the tokenizer noticeably sluggish. 200 KB is comfortable
  // for the typical source-file viewer use case while still flagging
  // when the rest of a huge file is being truncated.
  const HIGHLIGHT_CAP = 200 * 1024;
  const truncated = content.length > HIGHLIGHT_CAP;
  const display = truncated
    ? content.slice(0, HIGHLIGHT_CAP) +
      `\n\n[truncated for highlighter; ${formatBytes(content.length - HIGHLIGHT_CAP)} more - use Raw to see the rest]`
    : content;

  return (
    <Highlight code={display} language={language} theme={themes.vsDark}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${className} m-0 overflow-auto p-4 text-xs leading-relaxed`}
          style={style}
        >
          {tokens.map((line, i) => {
            const lineProps = getLineProps({ line, key: i });
            return (
              <div key={i} {...lineProps} className="table-row">
                <span className="table-cell select-none pr-3 text-right text-muted-fg/60">
                  {i + 1}
                </span>
                <span className="table-cell">
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token, key })} />
                  ))}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}
