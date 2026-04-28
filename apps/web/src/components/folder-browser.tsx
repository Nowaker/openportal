import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
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

interface PortalConfig {
  directories: string[];
}

interface FolderBrowserProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

function joinPath(parent: string, child: string): string {
  if (parent === "/") return `/${child}`;
  return `${parent}/${child}`;
}

function isUnderAny(target: string, bases: string[]): boolean {
  if (bases.length === 0) return true;
  return bases.some((b) => target === b || target.startsWith(b + "/"));
}

function findContainingBase(target: string, bases: string[]): string | null {
  return bases.find((b) => target === b || target.startsWith(b + "/")) ?? null;
}

export function FolderBrowserDialog({
  isOpen,
  onOpenChange,
  onSelect,
}: FolderBrowserProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={({ isEntering, isExiting }) =>
        [
          "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4",
          "bg-black/40 backdrop-blur-sm",
          isEntering ? "animate-in fade-in duration-200" : "",
          isExiting ? "animate-out fade-out duration-150" : "",
        ].join(" ")
      }
    >
      <Modal className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <FolderBrowserBody
              onClose={close}
              onSelect={(p) => {
                onSelect(p);
                close();
              }}
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
}

function FolderBrowserBody({ onClose, onSelect }: BodyProps) {
  const { data: configData } = useSWR<PortalConfig>(
    "/api/config/portal",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const baseDirs = useMemo(
    () => configData?.directories ?? [],
    [configData?.directories],
  );

  const [path, setPath] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [completionParent, setCompletionParent] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Entry[]>([]);
  const [showCompletions, setShowCompletions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (path !== null) return;
    if (!configData) return;
    if (baseDirs.length === 1) {
      setPath(baseDirs[0]);
    } else if (baseDirs.length > 1) {
      setPath("__BASES__");
    } else {
      setPath("");
    }
  }, [path, configData, baseDirs]);

  useEffect(() => {
    if (path === null || path === "__BASES__") {
      setData(null);
      return;
    }
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
          .filter((e) => {
            if (baseDirs.length === 0) return true;
            const candidate = joinPath(d.path, e.name);
            return baseDirs.some(
              (b) =>
                candidate === b ||
                candidate.startsWith(b + "/") ||
                b.startsWith(candidate + "/") ||
                b === candidate,
            );
          })
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
  }, [input, baseDirs]);

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
      if (target && isUnderAny(target, baseDirs)) {
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
    const next = joinPath(data.path, name);
    setPath(next);
  };

  const enterBase = (base: string) => {
    setPath(base);
  };

  const goUp = () => {
    if (path === "__BASES__") return;
    if (!data) return;
    const containingBase = findContainingBase(data.path, baseDirs);
    if (containingBase && data.path === containingBase) {
      if (baseDirs.length > 1) setPath("__BASES__");
      return;
    }
    if (data.parent && isUnderAny(data.parent, baseDirs)) {
      setPath(data.parent);
    }
  };

  const goHome = () => {
    if (baseDirs.length > 1) {
      setPath("__BASES__");
    } else if (baseDirs.length === 1) {
      setPath(baseDirs[0]);
    } else if (data?.home) {
      setPath(data.home);
    }
  };

  const upDisabled =
    path === "__BASES__" ||
    !data ||
    (baseDirs.length === 1 && data.path === baseDirs[0]) ||
    (baseDirs.length === 0 && !data.parent);

  const renderingBases = path === "__BASES__";
  const headerPath = renderingBases ? "Configured base directories" : data?.path || "Loading…";

  return (
    <>
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border shrink-0">
        <div>
          <h2 className="text-base font-semibold">Open directory</h2>
          <p className="text-xs text-muted-fg">
            Pick a folder under your configured base directories.
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

      <div className="px-4 pt-3 pb-2 border-b border-border space-y-1.5 shrink-0">
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
            placeholder={
              baseDirs.length > 0
                ? `Type a path within ${baseDirs[0]}... (Tab, Enter)`
                : "Type a path... (Tab, Enter)"
            }
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

      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted/10 shrink-0">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-fg">
            Current Folder
          </span>
          <span
            className="font-mono text-sm truncate"
            title={renderingBases ? "configured base directories" : data?.path}
          >
            {headerPath}
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
            disabled={upDisabled}
            title="Up one level"
            className="rounded-md p-1.5 hover:bg-muted/40 text-muted-fg disabled:opacity-40"
          >
            <ArrowUturnLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => !renderingBases && data?.path && onSelect(data.path)}
            disabled={renderingBases || !data?.path}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/30 disabled:opacity-40"
          >
            Select Current
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
        {renderingBases &&
          baseDirs.map((base) => (
            <div
              key={base}
              className="flex items-center gap-2 border-b border-border/50 px-4 hover:bg-muted/20"
            >
              <button
                type="button"
                onClick={() => enterBase(base)}
                className="flex flex-1 items-center gap-2 py-2 text-left text-sm min-w-0"
                title={base}
              >
                <FolderIcon className="size-4 shrink-0 text-muted-fg" />
                <span className="truncate font-mono">{base}</span>
              </button>
              <button
                type="button"
                onClick={() => onSelect(base)}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-primary hover:text-primary-fg"
              >
                Select
              </button>
            </div>
          ))}
        {!renderingBases && loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-fg">
            Loading...
          </div>
        )}
        {!renderingBases && data?.error && (
          <div className="px-4 py-3 text-sm text-danger-subtle-fg bg-danger-subtle">
            {data.error}
          </div>
        )}
        {!renderingBases &&
          !loading &&
          data &&
          !data.error &&
          sortedEntries.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-fg">
              (no subdirectories)
            </div>
          )}
        {!renderingBases &&
          !loading &&
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
