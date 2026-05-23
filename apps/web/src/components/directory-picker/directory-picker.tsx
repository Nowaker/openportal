import * as React from "react";
import {
  Modal,
  ModalOverlay,
  Dialog as PrimitiveDialog,
} from "react-aria-components";
import {
  FolderIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { Session } from "@opencode-ai/sdk";
import { useSessions } from "@/hooks/use-opencode";

// Section L + M's shared directory picker. v1 ships a flat-list mode:
// the entries are the unique session directories on the active server,
// filtered by case-insensitive substring of either the directory path
// or the basename. ArrowUp/ArrowDown navigates the visible matches,
// Enter confirms, Escape cancels. The hybrid tree-navigation (Tab/Right
// to descend, Backspace/Left to ascend) the user described will land in
// a v2 follow-up - Sections L (fork) and M (move) only need flat
// selection of "which project should this session go to".

interface DirectoryEntry {
  path: string;
  basename: string;
  sessionCount: number;
  lastActivity: number;
}

function buildEntries(sessions: Session[]): DirectoryEntry[] {
  const byDir = new Map<string, DirectoryEntry>();
  for (const s of sessions) {
    const dir = (s.directory ?? "").replace(/\/+$/, "");
    if (!dir) continue;
    const activity =
      (s.time?.updated as number | undefined) ??
      (s.time?.created as number | undefined) ??
      0;
    const existing = byDir.get(dir);
    if (existing) {
      existing.sessionCount++;
      if (activity > existing.lastActivity) existing.lastActivity = activity;
    } else {
      byDir.set(dir, {
        path: dir,
        basename: dir.split("/").filter(Boolean).pop() ?? dir,
        sessionCount: 1,
        lastActivity: activity,
      });
    }
  }
  return Array.from(byDir.values()).sort(
    (a, b) =>
      b.lastActivity - a.lastActivity || a.path.localeCompare(b.path),
  );
}

function filterEntries(
  entries: DirectoryEntry[],
  query: string,
): DirectoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.path.toLowerCase().includes(q) ||
      e.basename.toLowerCase().includes(q),
  );
}

export interface DirectoryPickerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  title?: string;
  initialQuery?: string;
  excludePath?: string | null;
}

export function DirectoryPicker({
  isOpen,
  onOpenChange,
  onSelect,
  title = "Choose a project",
  initialQuery = "",
  excludePath = null,
}: DirectoryPickerProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
    >
      <Modal className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-xl border border-border bg-bg shadow-2xl outline-none">
        <PrimitiveDialog className="flex flex-col flex-1 min-h-0 outline-none">
          {({ close }) => (
            <Body
              title={title}
              initialQuery={initialQuery}
              excludePath={excludePath}
              onClose={close}
              onSelect={(path) => {
                onSelect(path);
                close();
              }}
            />
          )}
        </PrimitiveDialog>
      </Modal>
    </ModalOverlay>
  );
}

function Body({
  title,
  initialQuery,
  excludePath,
  onClose,
  onSelect,
}: {
  title: string;
  initialQuery: string;
  excludePath: string | null;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const { data: sessionsData } = useSessions();
  const sessions: Session[] = (sessionsData as Session[] | undefined) ?? [];
  const [query, setQuery] = React.useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  React.useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const entries = React.useMemo(() => buildEntries(sessions), [sessions]);
  const filtered = React.useMemo(
    () =>
      filterEntries(entries, query).filter(
        (e) => !excludePath || e.path !== excludePath,
      ),
    [entries, query, excludePath],
  );

  React.useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  React.useEffect(() => {
    const li = listRef.current?.querySelector<HTMLLIElement>(
      `[data-picker-index="${selectedIndex}"]`,
    );
    if (li) li.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length === 0 ? 0 : (prev + 1) % filtered.length,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length === 0
          ? 0
          : prev - 1 < 0
            ? filtered.length - 1
            : prev - 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = filtered[selectedIndex];
      if (choice) onSelect(choice.path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close picker"
          className="inline-flex items-center justify-center size-7 rounded text-muted-fg hover:bg-muted hover:text-fg"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
      <div className="flex flex-col flex-1 min-h-0 p-3 gap-3">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-fg pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type to filter projects..."
            className="w-full rounded-md border border-border bg-bg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            aria-label="Filter projects"
            data-test="portal-directory-picker-filter"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-fg">
            {entries.length === 0
              ? "No projects with sessions found on this server."
              : `No matches for "${query}".`}
          </div>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Projects"
            className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border divide-y divide-border"
          >
            {filtered.map((entry, idx) => (
              <li
                key={entry.path}
                data-picker-index={idx}
                role="option"
                aria-selected={idx === selectedIndex}
                tabIndex={-1}
                onClick={() => {
                  setSelectedIndex(idx);
                  onSelect(entry.path);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`flex items-start gap-3 px-3 py-2 cursor-pointer ${
                  idx === selectedIndex
                    ? "bg-accent/15 text-fg"
                    : "hover:bg-muted/40"
                }`}
                data-test={`portal-directory-picker-entry-${idx}`}
              >
                <FolderIcon className="size-4 text-muted-fg shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {entry.basename}
                  </div>
                  <div className="text-xs text-muted-fg truncate font-mono">
                    {entry.path}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted-fg whitespace-nowrap">
                  {entry.sessionCount} session
                  {entry.sessionCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="text-xs text-muted-fg flex flex-wrap gap-x-3 gap-y-1">
          <span>
            <kbd className="rounded border border-border bg-muted/30 px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted/30 px-1 py-0.5 font-mono text-[10px]">Enter</kbd> confirm
          </span>
          <span>
            <kbd className="rounded border border-border bg-muted/30 px-1 py-0.5 font-mono text-[10px]">Esc</kbd> cancel
          </span>
        </div>
      </div>
    </>
  );
}
