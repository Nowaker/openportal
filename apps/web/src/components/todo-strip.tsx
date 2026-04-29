import {
  CheckIcon,
  ChevronUpIcon,
  ClipboardDocumentListIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { TodoItem, TodoSnapshot } from "@/lib/todos";
import { useTodoExpandStore } from "@/stores/todo-expand-store";

interface Props {
  snapshot: TodoSnapshot | null;
}

export function TodoStrip({ snapshot }: Props) {
  const expanded = useTodoExpandStore((s) => s.expanded);
  const toggle = useTodoExpandStore((s) => s.toggle);

  if (!snapshot || snapshot.todos.length === 0) return null;

  const total = snapshot.todos.length;
  const done = snapshot.todos.filter((t) => t.status === "completed").length;
  const active = snapshot.todos.filter(
    (t) => t.status === "in_progress",
  ).length;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={expanded}
      aria-label={`Plan: ${done} of ${total} done`}
      title={`Plan: ${done} of ${total} done${active > 0 ? `, ${active} in progress` : ""}`}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-xs text-muted-fg hover:text-fg hover:border-fg/40 transition-colors"
    >
      <ClipboardDocumentListIcon className="hidden sm:inline-block size-3.5" />
      <span className="tabular-nums">
        <span className="sm:hidden">{done}/{total}</span>
        <span className="hidden sm:inline">
          {done}/{total} done
          {active > 0 ? `, ${active} in progress` : ""}
        </span>
      </span>
      <ProgressBar done={done} total={total} active={active} />
      <ChevronUpIcon
        className={`hidden sm:inline-block size-3.5 transition-transform ${expanded ? "" : "rotate-180"}`}
      />
    </button>
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
      className="hidden sm:flex h-1.5 w-16 rounded-full border border-border/60 bg-bg overflow-hidden"
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

interface FloatProps {
  snapshot: TodoSnapshot | null;
}

export function TodoFloat({ snapshot }: FloatProps) {
  const expanded = useTodoExpandStore((s) => s.expanded);
  const close = useTodoExpandStore((s) => s.close);

  if (!expanded || !snapshot || snapshot.todos.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-3 top-16 z-30 w-[min(20rem,calc(100vw-1.5rem))]">
      <div className="pointer-events-auto rounded-md border border-border bg-bg/95 shadow-lg backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-border/60 px-2 py-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-fg">
            <ClipboardDocumentListIcon className="size-3.5" />
            <span className="tabular-nums">
              {snapshot.todos.filter((t) => t.status === "completed").length}/
              {snapshot.todos.length} done
            </span>
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close plan"
            className="rounded p-0.5 text-muted-fg hover:bg-muted/40 hover:text-fg"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <TodoBody todos={snapshot.todos} />
        </div>
      </div>
    </div>
  );
}

function TodoBody({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="py-1">
      {todos.map((todo) => (
        <li
          key={todo.id}
          className="flex items-start gap-2 px-2 py-1 text-xs"
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
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
        aria-label="completed"
      >
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500/20"
        aria-label="in progress"
      >
        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-fg/40 text-muted-fg"
        aria-label="cancelled"
      >
        <XMarkIcon className="size-2.5" />
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 inline-flex size-4 shrink-0 rounded-full border border-muted-fg/40"
      aria-label="pending"
    />
  );
}
