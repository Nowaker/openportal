import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod/v4";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import {
  useStarredMessages,
  unstarMessage,
  type StarredMessage,
} from "@/stores/starred-messages-store";
import { useInstanceStore } from "@/stores/instance-store";
import { useSessions } from "@/hooks/use-opencode";
import { PageTitle } from "@/components/ui/typography";
import { Loader } from "@/components/ui/loader";
import { useDateFormatStore } from "@/stores/date-format-store";
import { formatMessageTime, formatAbsoluteAndRelative } from "@/lib/format-time";

const pinnedSearchSchema = z.object({
  scope: z.enum(["all", "project", "session"]).optional(),
  session: z.string().optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/_app/pinned")({
  component: PinnedMessagesPage,
  validateSearch: pinnedSearchSchema,
});

type Scope = "all" | "project" | "session";

function PinnedMessagesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data, isLoading } = useStarredMessages();
  const items: StarredMessage[] = data?.items ?? [];
  const activeServerId = useInstanceStore((s) => s.instance?.id ?? null);
  const { data: sessionsData } = useSessions();
  const dateFormat = useDateFormatStore((s) => s.format);
  const focusedSessionId = search.session ?? null;
  const sessionTitleById = useMemo(() => {
    const out = new Map<string, string>();
    for (const s of sessionsData ?? []) {
      out.set(s.id, s.title || s.id);
    }
    return out;
  }, [sessionsData]);
  const focusedSession = focusedSessionId
    ? sessionsData?.find((s) => s.id === focusedSessionId)
    : null;
  const focusedDirectory = focusedSession?.directory;
  const scope: Scope = search.scope ?? "all";
  const [searchInput, setSearchInput] = useState(search.q ?? "");
  const filtered = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    const filteredByScope = items.filter((m) => {
      if (scope === "session" && focusedSessionId) {
        return m.sessionId === focusedSessionId;
      }
      if (scope === "project" && focusedDirectory) {
        return m.directory === focusedDirectory;
      }
      return true;
    });
    const filteredByText = q
      ? filteredByScope.filter((m) =>
          (m.snippet ?? "").toLowerCase().includes(q),
        )
      : filteredByScope;
    return filteredByText
      .slice()
      .sort((a, b) => b.starredAt - a.starredAt);
  }, [items, scope, focusedSessionId, focusedDirectory, search.q]);
  const updateSearch = (
    patch: Partial<{ scope: Scope; session: string; q: string }>,
  ) => {
    void navigate({
      to: "/pinned",
      search: (prev) => ({
        ...prev,
        ...patch,
      }),
    });
  };
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border px-4 py-3 flex flex-col gap-2 shrink-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <PageTitle as="h2">Pinned messages</PageTitle>
          <span className="text-xs text-muted-fg">
            {filtered.length} / {items.length} starred
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <FilterPill
            active={scope === "all"}
            onClick={() => updateSearch({ scope: "all" })}
          >
            All
          </FilterPill>
          <FilterPill
            active={scope === "project"}
            disabled={!focusedDirectory}
            onClick={() => updateSearch({ scope: "project" })}
            title={
              focusedDirectory
                ? `Filter to ${focusedDirectory}`
                : "Open a session first to filter by project"
            }
          >
            This project
          </FilterPill>
          <FilterPill
            active={scope === "session"}
            disabled={!focusedSessionId}
            onClick={() => updateSearch({ scope: "session" })}
            title={
              focusedSessionId
                ? `Filter to ${focusedSessionId}`
                : "Open a session first to filter by session"
            }
          >
            This session
          </FilterPill>
          <div className="flex-1 min-w-32" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => updateSearch({ q: searchInput })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateSearch({ q: searchInput });
              }
            }}
            placeholder="Search snippets..."
            className="rounded border border-border bg-bg px-2 py-1 text-xs w-48"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading && items.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader className="size-5" />
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-8 text-sm text-muted-fg text-center">
            No starred messages
            {scope !== "all" ? ` match the ${scope} filter` : ""}
            {search.q ? ` and the search '${search.q}'` : ""}.
          </div>
        )}
        {filtered.map((m) => {
          const isActiveServer =
            activeServerId === null || activeServerId === m.serverId;
          const title =
            m.sessionTitle ??
            sessionTitleById.get(m.sessionId) ??
            m.sessionId;
          const when = formatMessageTime(m.starredAt, dateFormat);
          const whenTitle = formatAbsoluteAndRelative(m.starredAt);
          return (
            <div
              key={`${m.serverId}::${m.messageId}`}
              data-role={m.role}
              className="relative px-3 py-3 border-b border-border"
            >
              <div className="flex items-baseline gap-2 flex-wrap mb-1">
                <StarIconSolid className="size-3.5 text-warning shrink-0" />
                <Link
                  to="/session/$id"
                  params={{ id: m.sessionId }}
                  search={(prev) => ({
                    ...prev,
                    server: isActiveServer ? undefined : m.serverId,
                  })}
                  hash={`msg-${m.messageId}`}
                  className="text-xs font-mono text-primary hover:underline truncate"
                  title={`${m.sessionId} - jump to message`}
                >
                  {title}
                </Link>
                <span
                  className="text-[10px] uppercase tracking-wide text-muted-fg shrink-0"
                  title={m.directory ?? ""}
                >
                  {m.role}
                </span>
                <span
                  className="ml-auto text-[10px] font-mono tabular-nums text-muted-fg/70 shrink-0"
                  title={whenTitle}
                >
                  {when}
                </span>
                <button
                  type="button"
                  onClick={() => void unstarMessage(m.serverId, m.messageId)}
                  className="text-[10px] text-muted-fg hover:text-danger shrink-0"
                  title="Unstar"
                >
                  unstar
                </button>
              </div>
              {m.snippet ? (
                <div className="text-xs text-fg whitespace-pre-wrap break-words pr-2">
                  {m.snippet}
                </div>
              ) : (
                <div className="text-xs text-muted-fg italic">
                  No snippet recorded
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterPill({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md border px-2 py-1 transition-colors ${
        active
          ? "border-primary/40 bg-primary/10 text-fg"
          : disabled
            ? "border-border bg-bg/40 text-muted-fg/40 cursor-not-allowed"
            : "border-border bg-bg text-fg hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
