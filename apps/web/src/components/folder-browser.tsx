import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Loader } from "@/components/ui/loader";
import {
  ModalOverlay,
  Modal,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  FolderIcon,
  XMarkIcon,
  ArrowLeftIcon,
} from "@heroicons/react/24/outline";
import { Bars3Icon } from "@heroicons/react/24/outline";
import {
  resolveToolsFromState,
  useToolsStore,
  type ResolvedTool,
} from "@/stores/tools-store";
import { PathInput, type PathInputHandle } from "@/components/ui/path-input";
import {
  fromTildeDisplay,
  splitInput,
  toTildeDisplay,
} from "@/lib/path-utils";

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

// onSelect's second arg is the auto-prompt to submit on the new session's
// first turn. Set when the user just created a brand-new project from the
// non-existent-path flow and picked at least one init template.
interface FolderBrowserProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string, autoPrompt?: string) => void;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

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

function splitParentLeaf(absPath: string): { parent: string; leaf: string } {
  const trimmed = absPath.replace(/\/+$/g, "") || "/";
  if (trimmed === "/") return { parent: "/", leaf: "" };
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) {
    return { parent: "/", leaf: trimmed.slice(1) };
  }
  return { parent: trimmed.slice(0, idx), leaf: trimmed.slice(idx + 1) };
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
          "bg-black/70",
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
              onSelect={(p, autoPrompt) => {
                onSelect(p, autoPrompt);
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
  onSelect: (path: string, autoPrompt?: string) => void;
}

interface CreateState {
  parent: string;
  leaf: string;
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
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const inputRef = useRef<PathInputHandle>(null);

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
    setTimeout(() => inputRef.current?.setCaretEnd(), 50);
  }, [pathInput, configData, baseDirs, lcd]);

  const { dir, prefix } = useMemo(
    () => (pathInput === null ? { dir: "", prefix: "" } : splitInput(pathInput)),
    [pathInput],
  );

  useEffect(() => {
    if (pathInput === null) return;
    if (createState) return;
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
  }, [dir, pathInput, createState]);

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    if (!prefix) return data.entries;
    const lower = prefix.toLowerCase();
    return data.entries.filter((e) => e.name.toLowerCase().startsWith(lower));
  }, [data?.entries, prefix]);

  // Probes a path; if it doesn't exist (and parent is in scope + accessible),
  // switches to the create-project view. Otherwise opens the path normally.
  const probeAndSelect = async (rawPath: string) => {
    const trimmed = rawPath.replace(/\/+$/g, "") || "/";
    setProbing(true);
    setProbeError(null);
    try {
      const res = await fetch(
        `/api/fs/list?path=${encodeURIComponent(trimmed)}`,
      );
      const probe: ListResponse = await res.json();
      if (probe.error) {
        const { parent, leaf } = splitParentLeaf(trimmed);
        if (!leaf) {
          setProbeError(probe.error);
          return;
        }
        const parentRes = await fetch(
          `/api/fs/list?path=${encodeURIComponent(parent)}`,
        );
        const parentProbe: ListResponse = await parentRes.json();
        if (parentProbe.error) {
          setProbeError(
            `Parent directory not accessible: ${parentProbe.error}`,
          );
          return;
        }
        setCreateState({ parent, leaf });
        return;
      }
      onSelect(trimmed);
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : "probe failed");
    } finally {
      setProbing(false);
    }
  };

  const onEntrySelect = (entry: Entry) => {
    const fullPath = (dir || "/") + entry.name;
    onSelect(fullPath);
  };

  const completePath = (entry: Entry) => {
    setPathInput((dir || "/") + entry.name + "/");
    requestAnimationFrame(() => inputRef.current?.setCaretEnd());
  };

  if (createState) {
    return (
      <CreateProjectView
        parent={createState.parent}
        leaf={createState.leaf}
        onCancel={() => setCreateState(null)}
        onCreated={(path, autoPrompt) => {
          onSelect(path, autoPrompt);
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border shrink-0">
        <div>
          <h2 className="text-base font-semibold">Open directory</h2>
          <p className="text-xs text-muted-fg">
            Type a path. Tab completes; Enter opens. Type a non-existent
            path to create a new project.
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
        <PathInput
          ref={inputRef}
          value={pathInput ?? ""}
          onChange={setPathInput}
          onSubmit={() => pathInput && probeAndSelect(pathInput)}
          entries={filteredEntries}
          disabled={probing}
        />
        {probeError && (
          <p className="mt-2 text-xs text-danger-subtle-fg">{probeError}</p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
        {loading && filteredEntries.length === 0 && (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-fg">
            <Loader className="size-4" />
            <span>Loading…</span>
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

interface CreateProjectViewProps {
  parent: string;
  leaf: string;
  onCancel: () => void;
  onCreated: (path: string, autoPrompt?: string) => void;
  onClose: () => void;
}

function CreateProjectView({
  parent,
  leaf,
  onCancel,
  onCreated,
  onClose,
}: CreateProjectViewProps) {
  const disabledIds = useToolsStore((s) => s.disabledIds);
  const burgerHiddenIds = useToolsStore((s) => s.burgerHiddenIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);
  const defaultOnInitIds = useToolsStore((s) => s.defaultOnInitIds);
  const slashCommandIds = useToolsStore((s) => s.slashCommandIds);

  const tools = useMemo(
    () =>
      resolveToolsFromState({
        disabledIds,
        burgerHiddenIds,
        systemOverrides,
        customTools,
        projectInitOrder,
        defaultOnInitIds,
        slashCommandIds,
      }),
    [
      disabledIds,
      burgerHiddenIds,
      systemOverrides,
      customTools,
      projectInitOrder,
      defaultOnInitIds,
      slashCommandIds,
    ],
  );

  // Initial ordering: init-marked tools first (in projectInitOrder),
  // then everything else alphabetically. The user can drag-reorder this
  // ad-hoc for THIS create flow only - global init order is not mutated.
  const initialOrder = useMemo(() => {
    const initSet = new Set(projectInitOrder);
    const inOrder = projectInitOrder
      .map((id) => tools.find((t) => t.id === id))
      .filter((t): t is ResolvedTool => Boolean(t));
    const others = tools
      .filter((t) => !initSet.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...inOrder, ...others];
  }, [tools, projectInitOrder]);

  const [order, setOrder] = useState<ResolvedTool[]>(initialOrder);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultOnInitIds.filter((id) => projectInitOrder.includes(id))),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const targetPath = parent === "/" ? `/${leaf}` : `${parent}/${leaf}`;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = (targetId: string) => {
    const sourceId = dragSourceIdRef.current;
    dragSourceIdRef.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    setOrder((prev) => {
      const next = prev.slice();
      const from = next.findIndex((t) => t.id === sourceId);
      const to = next.findIndex((t) => t.id === targetId);
      if (from === -1 || to === -1) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent, name: leaf, gitInit: true }),
      });
      if (!res.ok) {
        const fallback = `mkdir failed: ${res.status}`;
        const body = await res.text();
        let msg = fallback;
        if (body) {
          try {
            const j = JSON.parse(body);
            msg = j?.message ?? j?.statusMessage ?? fallback;
          } catch {
            msg = body.length > 200 ? fallback : body;
          }
        }
        throw new Error(msg);
      }
      const result = (await res.json()) as {
        path: string;
        gitInitFailed?: boolean;
      };

      // Concatenate the prompts of every CHECKED template, in current
      // user-visible order. Empty if nothing checked - that path skips
      // auto-submit and just opens the new-session composer normally.
      const checkedInOrder = order.filter((t) => selected.has(t.id));
      const autoPrompt =
        checkedInOrder.length > 0
          ? checkedInOrder.map((t) => t.prompt).join("\n\n---\n\n")
          : undefined;

      onCreated(result.path, autoPrompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border shrink-0">
        <div className="flex items-start gap-2 min-w-0">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Back"
            className="rounded p-1 hover:bg-muted/30 text-muted-fg hover:text-fg shrink-0 mt-0.5"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Create new project?</h2>
            <p className="text-xs text-muted-fg break-all font-mono">
              {targetPath}
            </p>
            <p className="text-xs text-muted-fg mt-1">
              The directory will be created and <code>git init</code> will
              run inside it. Pick the templates to auto-submit as the
              session's first prompt - drag to reorder.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 hover:bg-muted/30 text-muted-fg hover:text-fg shrink-0"
        >
          <XMarkIcon className="size-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto overscroll-contain p-3 space-y-1">
        {order.map((tool) => {
          const isDragOver = dragOverId === tool.id;
          const isSelected = selected.has(tool.id);
          return (
            <div
              key={tool.id}
              draggable
              onDragStart={(e) => {
                dragSourceIdRef.current = tool.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", tool.id);
              }}
              onDragOver={(e) => {
                if (!dragSourceIdRef.current) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverId !== tool.id) setDragOverId(tool.id);
              }}
              onDragLeave={() => {
                if (dragOverId === tool.id) setDragOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(tool.id);
              }}
              onDragEnd={() => {
                dragSourceIdRef.current = null;
                setDragOverId(null);
              }}
              className={`flex items-center gap-2 rounded-md border border-border bg-bg/60 px-2 py-1.5 text-sm ${
                isDragOver ? "bg-primary/10 border-primary/40" : ""
              }`}
            >
              <Bars3Icon className="size-4 text-muted-fg shrink-0 cursor-grab active:cursor-grabbing" />
              <label className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(tool.id)}
                  className="size-4 accent-primary shrink-0"
                />
                <span className="truncate">{tool.name}</span>
              </label>
              {!tool.enabled && (
                <span className="text-[10px] uppercase tracking-wide text-muted-fg shrink-0">
                  disabled
                </span>
              )}
            </div>
          );
        })}
        {order.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted-fg">
            No tool templates available. Add some in Settings → Tools.
          </p>
        )}
      </div>

      <div className="border-t border-border p-3 shrink-0 flex items-center justify-end gap-2">
        {error && (
          <p className="flex-1 text-xs text-danger-subtle-fg">{error}</p>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={creating}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/30 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create project"}
        </button>
      </div>
    </>
  );
}
