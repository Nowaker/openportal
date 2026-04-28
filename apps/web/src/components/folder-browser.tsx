import { useEffect, useMemo, useRef, useState } from "react";
import {
  ModalOverlay,
  Modal,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  ArrowUturnLeftIcon,
  FolderIcon,
  HomeIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

interface Entry {
  name: string;
  isDir: boolean;
}

interface ListResponse {
  path: string;
  parent: string | null;
  home: string;
  entries: Entry[];
  error?: string;
}

interface FolderBrowserProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

function joinPath(parent: string, child: string): string {
  if (parent === "/") return `/${child}`;
  return `${parent}/${child}`;
}

export function FolderBrowserDialog({
  isOpen,
  onOpenChange,
  onSelect,
  initialPath,
}: FolderBrowserProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={({ isEntering, isExiting }) =>
        [
          "fixed inset-0 z-50 flex items-center justify-center p-4",
          "bg-black/40 backdrop-blur-sm",
          isEntering ? "animate-in fade-in duration-200" : "",
          isExiting ? "animate-out fade-out duration-150" : "",
        ].join(" ")
      }
    >
      <Modal className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col h-full outline-none">
          {({ close }) => (
            <FolderBrowserBody
              onClose={close}
              onSelect={(p) => {
                onSelect(p);
                close();
              }}
              initialPath={initialPath}
            />
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

interface BodyProps {
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

function FolderBrowserBody({ onClose, onSelect, initialPath }: BodyProps) {
  const [path, setPath] = useState<string>(initialPath || "");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [completionParent, setCompletionParent] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Entry[]>([]);
  const [showCompletions, setShowCompletions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = path
      ? `/api/fs/list?path=${encodeURIComponent(path)}`
      : `/api/fs/list`;
    fetch(url)
      .then((r) => r.json())
      .then((d: ListResponse) => {
        if (cancelled) return;
        setData(d);
        if (!path && d.path) setPath(d.path);
      })
      .catch((e) => {
        if (cancelled) return;
        setData({
          path,
          parent: null,
          home: "",
          entries: [],
          error: e instanceof Error ? e.message : "fetch failed",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    if (!input) {
      setCompletions([]);
      setCompletionParent(null);
      return;
    }
    const lastSlash = input.lastIndexOf("/");
    const parent =
      lastSlash <= 0 ? "/" : input.slice(0, lastSlash) || "/";
    const prefix = lastSlash >= 0 ? input.slice(lastSlash + 1) : input;
    let cancelled = false;
    fetch(`/api/fs/list?path=${encodeURIComponent(parent)}`)
      .then((r) => r.json())
      .then((d: ListResponse) => {
        if (cancelled) return;
        if (!d.entries) {
          setCompletions([]);
          return;
        }
        const matches = d.entries
          .filter((e) =>
            e.name.toLowerCase().startsWith(prefix.toLowerCase()),
          )
          .slice(0, 8);
        setCompletionParent(d.path);
        setCompletions(matches);
      })
      .catch(() => {
        if (cancelled) return;
        setCompletions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [input]);

  const sortedEntries = useMemo(
    () => data?.entries ?? [],
    [data?.entries],
  );

  const acceptCompletion = (entry: Entry) => {
    if (!completionParent) return;
    const next = joinPath(completionParent, entry.name);
    setInput(next);
    setShowCompletions(false);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && completions.length > 0) {
      e.preventDefault();
      acceptCompletion(completions[0]);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target =
        completions.length > 0 && completionParent
          ? joinPath(completionParent, completions[0].name)
          : input;
      if (target) {
        setPath(target);
        setInput("");
        setShowCompletions(false);
      }
      return;
    }
    if (e.key === "Escape") {
      setShowCompletions(false);
    }
  };

  const enterFolder = (name: string) => {
    if (!data) return;
    setPath(joinPath(data.path, name));
  };

  const goUp = () => {
    if (data?.parent) setPath(data.parent);
  };

  const goHome = () => {
    if (data?.home) setPath(data.home);
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold">Open directory</h2>
          <p className="text-xs text-muted-fg">
            Pick a folder to open as a project.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 hover:bg-muted/30 text-muted-fg hover:text-fg"
        >
          <XMarkIcon className="size-5" />
        </button>
      </div>

      <div className="px-4 pt-3 pb-2 border-b border-border space-y-1.5">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowCompletions(true);
            }}
            onFocus={() => setShowCompletions(true)}
            onBlur={() => setTimeout(() => setShowCompletions(false), 150)}
            onKeyDown={onInputKeyDown}
            placeholder="Type a path... (Tab to complete, Enter to open)"
            className="w-full rounded-md border border-border bg-muted/20 px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            autoFocus
          />
          {showCompletions && completions.length > 0 && completionParent && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-bg shadow-lg">
              {completions.map((entry, i) => (
                <button
                  key={entry.name}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => acceptCompletion(entry)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/40 ${i === 0 ? "bg-muted/20" : ""}`}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-fg" />
                  <span className="truncate font-mono">
                    {joinPath(completionParent, entry.name)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted/10">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-fg">
            Current Folder
          </span>
          <span
            className="font-mono text-sm truncate"
            title={data?.path || path}
          >
            {data?.path || path || "Loading..."}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={goHome}
            title="Home"
            className="rounded-md p-1.5 hover:bg-muted/40 text-muted-fg"
          >
            <HomeIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={goUp}
            disabled={!data?.parent}
            title="Up one level"
            className="rounded-md p-1.5 hover:bg-muted/40 text-muted-fg disabled:opacity-40"
          >
            <ArrowUturnLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => data?.path && onSelect(data.path)}
            disabled={!data?.path}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/30 disabled:opacity-40"
          >
            Select Current
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-fg">
            Loading...
          </div>
        )}
        {data?.error && (
          <div className="px-4 py-3 text-sm text-danger-subtle-fg bg-danger-subtle">
            {data.error}
          </div>
        )}
        {!loading && data && !data.error && sortedEntries.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-fg">
            (no subdirectories)
          </div>
        )}
        {!loading &&
          sortedEntries.map((entry) => {
            const fullPath = data ? joinPath(data.path, entry.name) : "";
            return (
              <div
                key={entry.name}
                className="flex items-center gap-2 border-b border-border/50 px-4 hover:bg-muted/20"
              >
                <button
                  type="button"
                  onClick={() => enterFolder(entry.name)}
                  className="flex flex-1 items-center gap-2 py-2 text-left text-sm min-w-0"
                  title={fullPath}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-fg" />
                  <span className="truncate">{entry.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(fullPath)}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-primary hover:text-primary-fg"
                >
                  Select
                </button>
              </div>
            );
          })}
      </div>
    </>
  );
}
