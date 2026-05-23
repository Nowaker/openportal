import * as React from "react";
import {
  BellIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  useSystemMessagesStore,
  type SystemMessage,
  type SystemMessageLevel,
} from "@/stores/system-messages-store";

const CATEGORY_LABELS: Record<string, string> = {
  connection: "Connection",
  restart: "Restart",
  install: "Install",
  "stuck-detector": "Stuck detector",
  notification: "Notification",
  other: "Other",
};

function LevelIcon({ level }: { level: SystemMessageLevel }) {
  if (level === "error") {
    return <ExclamationCircleIcon className="size-4 text-red-500" />;
  }
  if (level === "warning") {
    return <ExclamationTriangleIcon className="size-4 text-amber-500" />;
  }
  if (level === "success") {
    return <CheckCircleIcon className="size-4 text-emerald-500" />;
  }
  return <InformationCircleIcon className="size-4 text-blue-500" />;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function SystemMessagesDrawer() {
  const messages = useSystemMessagesStore((s) => s.messages);
  const unreadCount = useSystemMessagesStore((s) => s.unreadCount);
  const acknowledgeAll = useSystemMessagesStore((s) => s.acknowledgeAll);
  const clear = useSystemMessagesStore((s) => s.clear);
  const [open, setOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  // Close on Escape + outside-click. Outside-click via backdrop layer
  // beneath the drawer; the drawer itself stops pointerdown from
  // bubbling so clicks inside don't close it.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    if (open) acknowledgeAll();
  }, [open, acknowledgeAll]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="System messages"
        title="OpenPortal system messages"
        className="fixed bottom-3 left-3 z-30 inline-flex items-center justify-center size-8 rounded-md border border-border bg-bg shadow hover:bg-muted text-muted-fg hover:text-fg"
        data-test="portal-system-messages-trigger"
      >
        <BellIcon className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center size-4 rounded-full bg-red-500 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-[39] bg-transparent"
            onPointerDown={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="System messages"
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed bottom-14 left-3 z-40 flex flex-col w-[90vw] sm:w-[28rem] max-h-[70vh] rounded-md border border-border bg-bg shadow-xl overflow-hidden"
            data-test="portal-system-messages-drawer"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BellIcon className="size-4 text-muted-fg" />
                System messages
                <span className="text-xs text-muted-fg font-normal">
                  ({messages.length})
                </span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clear}
                    className="text-xs text-muted-fg hover:text-fg px-1.5 py-0.5 rounded hover:bg-muted/40"
                    title="Clear all"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-muted-fg hover:text-fg p-0.5 rounded hover:bg-muted/40"
                >
                  <XMarkIcon className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-fg">
                  No system messages yet.
                  <div className="mt-1 opacity-70">
                    Connection events, service restarts, plugin installs, and
                    other portal-side notifications land here.
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {messages.map((m) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      expanded={expandedId === m.id}
                      onToggle={() =>
                        setExpandedId((cur) => (cur === m.id ? null : m.id))
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MessageRow({
  message,
  expanded,
  onToggle,
}: {
  message: SystemMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails = Boolean(message.details);
  return (
    <li className="px-3 py-2 text-xs">
      <button
        type="button"
        onClick={hasDetails ? onToggle : undefined}
        className="w-full text-left flex items-start gap-2"
        aria-expanded={hasDetails ? expanded : undefined}
        disabled={!hasDetails}
      >
        <LevelIcon level={message.level} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="inline-flex items-center rounded border border-border/60 bg-muted/30 px-1 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-fg">
              {CATEGORY_LABELS[message.category] ?? message.category}
            </span>
            <span className="font-mono text-[10px] text-muted-fg tabular-nums">
              {formatTime(message.timestamp)}
            </span>
          </div>
          <div className="mt-0.5 [overflow-wrap:anywhere]">{message.message}</div>
          {hasDetails && expanded && (
            <pre className="mt-1 rounded border border-border/60 bg-muted/20 px-2 py-1 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
              {message.details}
            </pre>
          )}
        </div>
      </button>
    </li>
  );
}
