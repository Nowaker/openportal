import * as React from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
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
  version: "Version",
  session: "Session",
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
  const allMessages = useSystemMessagesStore((s) => s.messages);
  const isOpen = useSystemMessagesStore((s) => s.isOpen);
  const filter = useSystemMessagesStore((s) => s.filter);
  const acknowledgeAll = useSystemMessagesStore((s) => s.acknowledgeAll);
  const closeDrawer = useSystemMessagesStore((s) => s.closeDrawer);
  const clear = useSystemMessagesStore((s) => s.clear);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) acknowledgeAll();
  }, [isOpen, acknowledgeAll]);

  const messages = React.useMemo(() => {
    if (!filter) return allMessages;
    const dir = filter.projectDirectory;
    if (!dir) return allMessages.filter((m) => !m.projectDirectory);
    return allMessages.filter(
      (m) => !m.projectDirectory || m.projectDirectory === dir,
    );
  }, [allMessages, filter]);

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) closeDrawer();
      }}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50"
    >
      <Modal className="outline-none w-full max-w-md max-h-[90vh]">
        <PrimitiveDialog
          role="dialog"
          aria-label="System messages"
          className="relative outline-none rounded-xl bg-bg shadow-2xl border border-border/50 flex flex-col max-h-[90vh]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 shrink-0">
            <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
              <BellIcon className="size-4 text-muted-fg shrink-0" />
              <span className="truncate">
                System messages
                {filter ? (
                  <span className="ml-1 text-xs text-muted-fg font-normal">
                    ({filter.projectDirectory
                      ? `scope: ${filter.projectDirectory}`
                      : "system-only"}
                    )
                  </span>
                ) : (
                  <span className="ml-1 text-xs text-muted-fg font-normal">
                    (all)
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-fg font-normal shrink-0">
                {messages.length}
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
                onClick={closeDrawer}
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
                {filter
                  ? "No matching system messages."
                  : "No system messages yet."}
                <div className="mt-1 opacity-70">
                  Connection events, service restarts, plugin installs, version
                  mismatches, and other portal-side notifications land here.
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
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
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
