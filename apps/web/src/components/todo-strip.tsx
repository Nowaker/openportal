import { useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentListIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { TodoItem, TodoSnapshot } from "@/lib/todos";

interface Props {
  snapshot: TodoSnapshot | null;
  variant: "inline" | "indicator";
}

export function TodoStrip({ snapshot, variant }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!snapshot || snapshot.todos.length === 0) return null;

  const total = snapshot.todos.length;
  const done = snapshot.todos.filter((t) => t.status === "completed").length;
  const active = snapshot.todos.filter(
    (t) => t.status === "in_progress",
  ).length;

  if (variant === "indicator") {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`Plan: ${done} of ${total} done`}
          title={`Plan: ${done} of ${total} done`}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-fg hover:text-fg hover:border-fg/40"
        >
          <ClipboardDocumentListIcon className="size-3.5" />
          <span className="tabular-nums">
            {done}/{total}
          </span>
          {active > 0 && (
            <span
              className="size-1.5 rounded-full bg-amber-500 animate-pulse"
              aria-hidden
            />
          )}
        </button>
        {expanded && (
          <TodoOverlay
            snapshot={snapshot}
            onClose={() => setExpanded(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="border-b border-border bg-muted/10">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/20 transition-colors"
        aria-expanded={expanded}
      >
        <ClipboardDocumentListIcon className="size-3.5 shrink-0 text-muted-fg" />
        <span className="font-medium uppercase tracking-wide text-muted-fg text-[10px]">
          Plan
        </span>
        <span className="text-muted-fg tabular-nums">
          {done}/{total} done
          {active > 0 ? `, ${active} active` : ""}
        </span>
        <ProgressBar done={done} total={total} active={active} />
        {expanded ? (
          <ChevronUpIcon className="size-3.5 shrink-0 text-muted-fg" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-fg" />
        )}
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t border-border/40">
          <TodoBody todos={snapshot.todos} />
        </div>
      )}
    </div>
  );
}

function ProgressBar({
  done,
  total,
  active,
}: {
  done: number;
  total: number;
  active: number;
}) {
  if (total === 0) return null;
  const donePct = (done / total) * 100;
  const activePct = (active / total) * 100;
  return (
    <span
      aria-hidden
      className="ml-1 flex-1 max-w-32 h-1 rounded-full bg-muted/40 overflow-hidden flex"
    >
      <span
        className="bg-emerald-500 h-full"
        style={{ width: `${donePct}%` }}
      />
      <span
        className="bg-amber-500 h-full"
        style={{ width: `${activePct}%` }}
      />
    </span>
  );
}

function TodoBody({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="py-1">
      {todos.map((todo) => (
        <li
          key={todo.id}
          className="flex items-center gap-2 px-3 py-1 text-xs"
          data-status={todo.status}
        >
          <StatusIcon status={todo.status} />
          <span
            className={
              todo.status === "completed"
                ? "line-through text-muted-fg"
                : todo.status === "cancelled"
                  ? "text-muted-fg italic"
                  : "text-fg"
            }
          >
            {todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatusIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return (
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
        aria-label="completed"
      >
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500/20"
        aria-label="in progress"
      >
        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-fg/40 text-muted-fg"
        aria-label="cancelled"
      >
        <XMarkIcon className="size-2.5" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex size-4 shrink-0 rounded-full border border-muted-fg/40"
      aria-label="pending"
    />
  );
}

function TodoOverlay({
  snapshot,
  onClose,
}: {
  snapshot: TodoSnapshot;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-bg shadow-2xl flex flex-col max-h-[80dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <ClipboardDocumentListIcon className="size-4 text-muted-fg" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-fg">
              Plan
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-fg hover:text-fg hover:bg-muted/40"
          >
            <XMarkIcon className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          <TodoBody todos={snapshot.todos} />
        </div>
      </div>
    </div>
  );
}
