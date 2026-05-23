import * as React from "react";
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

// Section #21 + #26 + #27: the popup opens DIRECTLY ABOVE the strip,
// inherits the strip's width on desktop (with a reasonable minimum)
// and goes 90vw on mobile (5% margins + 5vh top cap). Long entries
// wrap via overflow-wrap: anywhere to avoid horizontal scrollbars.
// Position is computed via getBoundingClientRect on the strip's DOM
// ref so the popup's bottom edge always lands just above the strip,
// regardless of where the strip sits on the page (composer toolbar
// today, but the same logic works if it moves).

export function TodoStrip({ snapshot }: Props) {
  const expanded = useTodoExpandStore((s) => s.expanded);
  const toggle = useTodoExpandStore((s) => s.toggle);
  const close = useTodoExpandStore((s) => s.close);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  // Tracks when the popup was last dismissed via the outside-click
  // backdrop. The backdrop's pointerdown closes the popup, but the
  // SAME pointer interaction then propagates a click to the strip
  // button below (depending on where the user clicked) which calls
  // toggle() and immediately re-opens the popup. The user reported
  // this as 'clicking the todo bar closes and immediately shows the
  // big todo again'. The guard: if the strip's onClick fires within
  // 300ms of the last close, swallow it. Treats the close + click
  // as one atomic 'close' interaction the way the user expects.
  const lastCloseAtRef = React.useRef<number>(0);
  const [anchor, setAnchor] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const handleToggle = React.useCallback(() => {
    if (Date.now() - lastCloseAtRef.current < 300) return;
    toggle();
  }, [toggle]);
  const handleClose = React.useCallback(() => {
    lastCloseAtRef.current = Date.now();
    close();
  }, [close]);

  // Recompute anchor position whenever the popup opens or the viewport
  // resizes. fixed-positioning means we need viewport-relative coords;
  // scroll doesn't affect us because both the strip and the popup are
  // in the viewport-fixed composer region.
  React.useEffect(() => {
    if (!expanded) {
      setAnchor(null);
      return;
    }
    const update = () => {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [expanded]);

  if (!snapshot || snapshot.todos.length === 0) return null;

  const total = snapshot.todos.length;
  const done = snapshot.todos.filter((t) => t.status === "completed").length;
  const active = snapshot.todos.filter(
    (t) => t.status === "in_progress",
  ).length;
  const firstActiveContent = snapshot.todos.find(
    (t) => t.status === "in_progress",
  )?.content;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-label={`Plan: ${done} done${active > 0 ? `, ${active} in progress` : ""}, ${total} total`}
        title={`Plan: ${done} done${active > 0 ? ` + ${active} in progress` : ""} / ${total} total${firstActiveContent ? `: ${firstActiveContent}` : ""}`}
        className="min-w-0 inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1 text-xs text-muted-fg hover:text-fg hover:border-fg/40 transition-colors"
        data-test="portal-todo-strip"
      >
        <ClipboardDocumentListIcon className="hidden sm:inline-block size-3.5 shrink-0" />
        <span className="tabular-nums min-w-0 inline-flex items-baseline gap-0">
          <span className="sm:hidden">
            {done}
            {active > 0 ? `+${active}` : ""}/{total}
          </span>
          <span className="hidden sm:inline whitespace-nowrap">
            {done}
            {active > 0 ? `+${active}` : ""}/{total}
          </span>
          {firstActiveContent && (
            <span className="hidden md:inline-flex items-baseline min-w-0 ml-0">
              <span className="whitespace-nowrap">:&nbsp;</span>
              <span className="truncate max-w-[20ch] lg:max-w-[36ch] xl:max-w-[56ch] font-normal text-fg/80">
                {firstActiveContent}
              </span>
            </span>
          )}
        </span>
        <ProgressBar done={done} total={total} active={active} />
        <ChevronUpIcon
          className={`hidden sm:inline-block size-3.5 shrink-0 transition-transform ${expanded ? "" : "rotate-180"}`}
        />
      </button>
      {expanded && anchor && (
        <TodoPopup snapshot={snapshot} anchor={anchor} onClose={handleClose} />
      )}
    </>
  );
}

interface TodoPopupProps {
  snapshot: TodoSnapshot;
  anchor: { top: number; left: number; width: number };
  onClose: () => void;
}

function TodoPopup({ snapshot, anchor, onClose }: TodoPopupProps) {
  // Close on Escape or outside-click. Outside-click is a backdrop layer
  // beneath the popup; pointerdown bubbles to it before the popup
  // intercepts the click target inside.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const [mobile, setMobile] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < 640 : false,
  );
  React.useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mobile: 90vw width, 5vw side margins, top capped at 5vh. Bottom is
  // anchored 4px above the strip's top so the popup never extends down
  // past the minified component the user just clicked.
  // Desktop: inherits the strip's width with a reasonable minimum so a
  // tiny strip doesn't produce a tiny popup. Right-aligned to the
  // strip's right edge so the popup grows leftward from the strip.
  const positionStyle: React.CSSProperties = mobile
    ? {
        position: "fixed",
        left: "5vw",
        right: "5vw",
        bottom: `${typeof window !== "undefined" ? window.innerHeight - anchor.top + 4 : 0}px`,
        top: "5vh",
        maxHeight: `calc(95vh - ${typeof window !== "undefined" ? window.innerHeight - anchor.top + 4 : 0}px)`,
      }
    : {
        position: "fixed",
        left: `${anchor.left}px`,
        top: "auto",
        bottom: `${typeof window !== "undefined" ? window.innerHeight - anchor.top + 4 : 0}px`,
        width: `${Math.max(anchor.width, 360)}px`,
        maxHeight: "min(60vh, 480px)",
      };

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 z-[99]"
        onClick={onClose}
      />
      <div
        ref={popupRef}
        role="dialog"
        aria-label="Plan"
        className="z-[100] flex flex-col rounded-md border border-border bg-bg shadow-xl overflow-hidden"
        style={positionStyle}
        data-test="portal-todo-float"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-2 py-1 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-muted-fg">
            <ClipboardDocumentListIcon className="size-3.5" />
            <span className="tabular-nums">
              {snapshot.todos.filter((t) => t.status === "completed").length}/
              {snapshot.todos.length} done
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plan"
            className="rounded p-0.5 text-muted-fg hover:bg-muted/40 hover:text-fg"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <TodoBody todos={snapshot.todos} />
        </div>
      </div>
    </>
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

// TodoFloat is now a no-op shim. Pre-fix it was a stand-alone fixed-
// position popup rendered inside the chat scroll area; post-fix the
// popup lives inside TodoStrip itself (anchored above the strip).
// Kept as an exported no-op so the existing callsite in $id.tsx
// doesn't break - the actual popup renders from TodoStrip.
export function TodoFloat({ snapshot }: FloatProps) {
  void snapshot;
  return null;
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
            className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${
              todo.status === "completed"
                ? "text-muted-fg"
                : todo.status === "cancelled"
                  ? "text-muted-fg italic"
                  : "text-fg"
            }`}
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
