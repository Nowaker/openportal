import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod/v4";
import { useInstanceStore } from "@/stores/instance-store";
import { useVirtualSessionStore } from "@/stores/virtual-session-store";
import { useCreateSession } from "@/hooks/use-opencode";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SendIcon from "@/components/icons/send-icon";
import { useSWRConfig } from "swr";
import { mutate as mutateSWR } from "swr";
import { Bars3Icon } from "@heroicons/react/24/outline";
import {
  resolveToolsFromState,
  useToolsStore,
  type ResolvedTool,
} from "@/stores/tools-store";

const searchSchema = z.object({
  directory: z.string().optional(),
  autoPrompt: z.string().optional(),
});

export const Route = createFileRoute("/_app/session/new")({
  component: NewSessionPage,
  validateSearch: searchSchema,
});

function NewSessionPage() {
  const navigate = useNavigate();
  const { directory: directoryFromUrl, autoPrompt } = Route.useSearch();
  const storeDir = useVirtualSessionStore((s) => s.directory);
  const setStoreDir = useVirtualSessionStore((s) => s.setDirectory);
  const clearStore = useVirtualSessionStore((s) => s.clear);
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const createSession = useCreateSession();
  const { mutate: globalMutate } = useSWRConfig();

  const directory = directoryFromUrl || storeDir || null;

  useEffect(() => {
    if (directoryFromUrl && directoryFromUrl !== storeDir) {
      setStoreDir(directoryFromUrl);
    }
  }, [directoryFromUrl, storeDir, setStoreDir]);

  const disabledIds = useToolsStore((s) => s.disabledIds);
  const systemOverrides = useToolsStore((s) => s.systemOverrides);
  const customTools = useToolsStore((s) => s.customTools);
  const projectInitOrder = useToolsStore((s) => s.projectInitOrder);

  const tools = useMemo(
    () => resolveToolsFromState({ disabledIds, systemOverrides, customTools }),
    [disabledIds, systemOverrides, customTools],
  );

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
    () => new Set(projectInitOrder),
  );
  const dragSourceIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Sync if Settings -> Tools is mutated while this page is mounted (rare,
  // but otherwise the user would have to reload to see the change).
  useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

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

  const composedAutoPrompt = useMemo(() => {
    const checkedInOrder = order.filter((t) => selected.has(t.id));
    if (checkedInOrder.length === 0) return "";
    return checkedInOrder.map((t) => t.prompt).join("\n\n---\n\n");
  }, [order, selected]);

  // Initial textarea value: explicit autoPrompt search-param wins (came
  // from folder-browser CreateProjectView, already user-confirmed) over
  // composed-from-checked-templates fallback. The user can edit either
  // before submitting.
  const [text, setText] = useState(autoPrompt ?? composedAutoPrompt);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittedRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const hasUserEditedRef = useRef(false);

  // Reflect template-checkbox changes into the textarea ONLY if the user
  // hasn't manually edited it yet. Once they type, their text wins -
  // toggling templates after that would clobber their edits.
  useEffect(() => {
    if (autoPrompt) return;
    if (hasUserEditedRef.current) return;
    setText(composedAutoPrompt);
  }, [composedAutoPrompt, autoPrompt]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (!submittedRef.current) {
        clearStore();
      }
    };
  }, [clearStore]);

  const handleSubmit = async (override?: string) => {
    if (sending) return;
    if (!directory) {
      setError("No directory selected.");
      return;
    }
    const message = (override ?? text).trim();
    if (!message) return;
    if (!port) {
      setError("Portal not bound to opencode.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const session = await createSession({ directory });
      const sessionId = session.id;

      const res = await fetch(
        `/api/opencode/${port}/session/${sessionId}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        },
      );
      if (!res.ok) {
        throw new Error(`prompt failed: ${res.status}`);
      }

      submittedRef.current = true;
      clearStore();
      await globalMutate(`/api/opencode/${port}/sessions`);
      mutateSWR(
        (key) =>
          typeof key === "string" &&
          key.startsWith(`/api/opencode/${port}/session/${sessionId}/messages`),
      );
      navigate({ to: "/session/$id", params: { id: sessionId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
      setSending(false);
    }
  };

  // When the create-project flow lands here with a non-empty autoPrompt,
  // submit it automatically once - the user already confirmed the
  // templates in the folder browser, so the new-session composer is
  // skipped entirely. Guarded by ref + port presence so it fires exactly
  // once after the opencode port is known.
  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (!autoPrompt) return;
    if (!directory) return;
    if (!port) return;
    autoSubmittedRef.current = true;
    handleSubmit(autoPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, directory, port]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center text-muted-fg">
        No directory chosen. Use Open directory in the sidebar.
      </div>
    );
  }

  const showTemplatePicker = !autoPrompt && order.length > 0;

  return (
    <div className="flex h-full flex-col items-center justify-start gap-4 p-4 sm:p-6 overflow-y-auto">
      <div className="text-center max-w-2xl space-y-1 shrink-0">
        <p className="text-xs uppercase tracking-wide text-muted-fg">
          New session
        </p>
        <h1 className="text-base font-mono break-all">{directory}</h1>
        <p className="text-sm text-muted-fg">
          Type your first message. The session is created when you send.
        </p>
      </div>

      {showTemplatePicker && (
        <div className="w-full max-w-2xl rounded-lg border border-border bg-bg/60 p-3 space-y-2 shrink-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-fg">
              Init templates
            </h2>
            <p className="text-[11px] text-muted-fg/80">
              Checked = concatenated as first prompt. Drag to reorder.
            </p>
          </div>
          <div className="space-y-1">
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
          </div>
        </div>
      )}

      <div className="w-full max-w-2xl space-y-2 shrink-0">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            hasUserEditedRef.current = true;
            setText(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="What do you want to do?"
          className="min-h-[180px] font-mono text-xs"
          disabled={sending}
        />
        {error && (
          <div className="text-sm text-danger-subtle-fg bg-danger-subtle px-3 py-2 rounded">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            onPress={() => handleSubmit()}
            isDisabled={sending || !text.trim()}
          >
            <SendIcon />
            {sending ? "Starting…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
