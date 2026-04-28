import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  ModalOverlay,
  Modal,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import { FolderIcon, XMarkIcon } from "@heroicons/react/24/outline";

// Tracks visualViewport height to keep modal usable when on-screen keyboard
// opens on Android Chrome. dvh units don't always shrink for the IME.
function useVisualViewportHeight(): number | null {
  const [h, setH] = useState<number | null>(() =>
    typeof window !== "undefined" && window.visualViewport
      ? window.visualViewport.height
      : null,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setH(vv.height);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return h;
}

interface Entry {
  name: string;
  isDir: boolean;
}

interface ListResponse {
  path: string;
  parent: string | null;
  home: string;
  entries: Entry[];
  virtual?: boolean;
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
  if (!parent || parent === "") return `/${child}`;
  if (parent.endsWith("/")) return `${parent}${child}`;
  return `${parent}/${child}`;
}

function lowestCommonAncestor(paths: string[]): string {
  if (paths.length === 0) return "/";
  if (paths.length === 1) return paths[0];
  const segs = paths.map((p) => p.split("/"));
  const common: string[] = [];
  const minLen = Math.min(...segs.map((s) => s.length));
  for (let i = 0; i < minLen; i++) {
    const seg = segs[0][i];
    if (segs.every((s) => s[i] === seg)) common.push(seg);
    else break;
  }
  return common.length > 0 ? common.join("/") || "/" : "/";
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
      <ResponsiveModal>
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
      </ResponsiveModal>
    </ModalOverlay>
  );
}

function ResponsiveModal({ children }: { children: React.ReactNode }) {
  const vvHeight = useVisualViewportHeight();
  const style = vvHeight
    ? { maxHeight: `${Math.max(280, vvHeight - 24)}px` }
    : undefined;
  return (
    <Modal
      style={style}
      className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none"
    >
      {children}
    </Modal>
  );
}

interface BodyProps {
  onClose: () => void;
  onSelect: (path: string) => void;
}

function splitInput(input: string): { dir: string; prefix: string } {
  const lastSlash = input.lastIndexOf("/");
  if (lastSlash < 0) return { dir: "", prefix: input };
  return {
    dir: input.slice(0, lastSlash + 1),
    prefix: input.slice(lastSlash + 1),
  };
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
  const lcd = useMemo(() => lowestCommonAncestor(baseDirs), [baseDirs]);

  const [pathInput, setPathInput] = useState<string | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pathInput !== null) return;
    if (!configData) return;
    if (baseDirs.length === 1) {
      setPathInput(baseDirs[0] + "/");
    } else if (baseDirs.length > 1) {
      setPathInput(lcd === "/" ? "/" : lcd + "/");
    } else {
      setPathInput("/");
    }
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, 50);
  }, [pathInput, configData, baseDirs, lcd]);

  const { dir, prefix } = useMemo(
    () => (pathInput === null ? { dir: "", prefix: "" } : splitInput(pathInput)),
    [pathInput],
  );

  useEffect(() => {
    if (pathInput === null) return;
    let cancelled = false;
    setLoading(true);
    const fetchTarget = dir || "/";
    fetch(`/api/fs/list?path=${encodeURIComponent(fetchTarget)}`)
      .then((r) => r.json())
      .then((d: ListResponse) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setData({
          path: fetchTarget,
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
  }, [dir, pathInput]);

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    if (!prefix) return data.entries;
    const lower = prefix.toLowerCase();
    return data.entries.filter((e) => e.name.toLowerCase().startsWith(lower));
  }, [data?.entries, prefix]);

  const completePath = (entry: Entry) => {
    const next = (dir || "/") + entry.name + "/";
    setPathInput(next);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && filteredEntries.length > 0) {
      e.preventDefault();
      completePath(filteredEntries[0]);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!pathInput) return;
      const trimmed = pathInput.replace(/\/+$/g, "") || "/";
      onSelect(trimmed);
    }
  };

  const onEntrySelect = (entry: Entry) => {
    const fullPath = (dir || "/") + entry.name;
    onSelect(fullPath);
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border shrink-0">
        <div>
          <h2 className="text-base font-semibold">Open directory</h2>
          <p className="text-xs text-muted-fg">
            Type a path. Tab completes; Enter opens.
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

      <div className="px-4 pt-3 pb-3 border-b border-border shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={pathInput ?? ""}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
        {loading && filteredEntries.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-fg">
            Loading...
          </div>
        )}
        {data?.error && (
          <div className="px-4 py-3 text-sm text-danger-subtle-fg bg-danger-subtle">
            {data.error}
          </div>
        )}
        {!loading &&
          !data?.error &&
          data &&
          filteredEntries.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-fg">
              {prefix ? `No matches for "${prefix}"` : "(no subdirectories)"}
            </div>
          )}
        {filteredEntries.map((entry, i) => (
          <div
            key={entry.name}
            className={`flex items-center gap-2 border-b border-border/50 px-4 hover:bg-muted/20 ${i === 0 && prefix ? "bg-muted/15" : ""}`}
          >
            <button
              type="button"
              onClick={() => completePath(entry)}
              className="flex flex-1 items-center gap-2 py-2 text-left text-sm min-w-0"
              title={(dir || "/") + entry.name}
            >
              <FolderIcon className="size-4 shrink-0 text-muted-fg" />
              <span className="truncate font-mono">{entry.name}</span>
            </button>
            <button
              type="button"
              onClick={() => onEntrySelect(entry)}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-primary hover:text-primary-fg"
            >
              Select
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
