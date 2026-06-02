import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppPage, AppPageBody, AppPageHeader } from "@/components/app-page";
import { Loader } from "@/components/ui/loader";
import { PageTitle } from "@/components/ui/typography";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { useBreadcrumb } from "@/contexts/breadcrumb-context";
import { useSessions } from "@/hooks/use-opencode";
import {
  buildLiveRow,
  reconcileRows,
  type LiveMessageShape,
  type LiveRow,
} from "@/lib/live-messages-view";
import { useInstanceStore } from "@/stores/instance-store";

export const Route = createFileRoute("/_app/live-messages")({
  component: LiveMessagesPage,
});

function LiveMessagesPage() {
  const { setPageTitle } = useBreadcrumb();
  const instance = useInstanceStore((s) => s.instance);
  const port = instance?.port ?? null;
  const { data: sessionsData, isLoading: sessionsLoading } = useSessions();
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const seenByMessageIdRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    setPageTitle("Live messages");
    return () => setPageTitle(null);
  }, [setPageTitle]);

  const sessionPairs = useMemo(
    () =>
      (sessionsData ?? []).map((session) => ({
        id: session.id,
        title: session.title || "(untitled)",
      })),
    [sessionsData],
  );

  useEffect(() => {
    if (!port || sessionPairs.length === 0) return;
    let cancelled = false;

    const tick = async () => {
      setIsPolling(true);
      try {
        const chunks = await Promise.all(
          sessionPairs.map(async (session) => {
            const response = await fetch(
              `/api/opencode/${port}/session/${session.id}/messages?limit=25`,
            );
            if (!response.ok) {
              throw new Error(`HTTP ${response.status} for ${session.id}`);
            }
            const body = (await response.json()) as LiveMessageShape[];
            return { session, body };
          }),
        );

        if (cancelled) return;

        const now = Date.now();
        setRows((prev) => {
          let next = prev;
          for (const chunk of chunks) {
            for (const message of chunk.body) {
              if (!message?.info?.id) continue;
              const row = buildLiveRow({
                sessionId: chunk.session.id,
                sessionTitle: chunk.session.title,
                message,
                timestampMs: now,
              });
              next = reconcileRows({
                rows: next,
                seenByMessageId: seenByMessageIdRef.current,
                incoming: row,
                maxRows: 300,
              });
            }
          }
          return next;
        });

        setPollError(null);
      } catch (err) {
        if (!cancelled) {
          setPollError(err instanceof Error ? err.message : "Polling failed");
        }
      } finally {
        if (!cancelled) setIsPolling(false);
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 2_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [port, sessionPairs]);

  return (
    <AppPage>
      <StaleDataBanner
        headline="Showing cached live message view - OpenCode is unreachable."
        hint="OpenPortal keeps serving cached session messages until OpenCode is reachable again."
      />
      <AppPageHeader>
        <div className="flex items-center justify-between gap-3">
          <PageTitle className="mb-0">Live messages</PageTitle>
          <div className="text-xs text-muted-fg">
            {isPolling ? "Refreshing..." : "Refresh every 2s"}
          </div>
        </div>
      </AppPageHeader>

      {sessionsLoading && (
        <div className="p-4">
          <Loader />
        </div>
      )}

      {pollError && (
        <div className="mx-4 mt-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {pollError}
        </div>
      )}

      <AppPageBody>
        <div className="space-y-2">
          {rows.length === 0 && !sessionsLoading ? (
            <div className="text-sm text-muted-fg">No messages yet.</div>
          ) : (
            rows.map((row) => (
              <div
                key={`${row.key}:${row.timestampMs}`}
                className="rounded border border-border/70 bg-panel px-3 py-2"
              >
                <div
                  className={`mb-1 text-xs font-mono ${
                    row.role === "user"
                      ? "text-green-600 dark:text-green-400"
                      : "text-blue-600 dark:text-blue-400"
                  }`}
                >
                  [{row.sessionTitle}] {row.type}
                </div>
                <pre
                  className={`whitespace-pre-wrap break-words text-sm ${
                    row.isPlaceholder
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-fg"
                  }`}
                >
                  {row.text}
                </pre>
              </div>
            ))
          )}
        </div>
      </AppPageBody>
    </AppPage>
  );
}
