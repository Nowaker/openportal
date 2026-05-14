import useSWR from "swr";
import { useInstanceStore } from "@/stores/instance-store";

interface CompanionPluginState {
  schemaVersion: number;
  identity: {
    id: string;
    version: string;
    loadedAt: number;
    options: Record<string, unknown>;
    hooks: Record<string, boolean>;
    initError: string | null;
  };
  context: { directory: string; worktree: string; serverUrl: string };
  heartbeat: { lastWriteAt: number; intervalMs: number };
  events: {
    totalSeen: number;
    byType: Record<string, number>;
    recent: Array<{ at: number; type: string }>;
  };
  tools: Record<
    string,
    {
      callCount: number;
      totalMs: number;
      lastFiredAt: number | null;
      p50Ms: number | null;
      p95Ms: number | null;
    }
  >;
  toolDefinitionsSeen: string[];
  sessions: Record<
    string,
    {
      sessionId: string;
      messageCount: number;
      toolCount: number;
      permissionAskCount: number;
      compactionCount: number;
      firstSeenAt: number;
      lastSeenAt: number;
    }
  >;
  permissions: {
    totalAsked: number;
    recent: Array<{
      at: number;
      sessionId: string;
      permission: string;
      patternCount: number;
    }>;
  };
  compactions: { total: number };
}

interface CompanionSummary {
  available: boolean;
  stale: boolean;
  state: CompanionPluginState | null;
  filePath: string;
}

const fetcher = async (url: string): Promise<CompanionSummary> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function fmtAge(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 1000) return "just now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

export function CompanionTelemetryPanel() {
  const port = useInstanceStore((s) => s.instance?.port ?? null);
  const { data, isLoading } = useSWR<CompanionSummary>(
    port ? `/api/companion-plugin-state?port=${port}` : null,
    fetcher,
    { refreshInterval: 5000 },
  );

  if (isLoading && !data) return null;

  if (!data?.available) {
    return (
      <div className="border-t border-border pt-3 text-xs text-muted-fg space-y-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
          Companion telemetry
        </h3>
        <p>
          Install the openportal companion plugin to see live runtime telemetry.
        </p>
        <p className="font-mono text-[11px] break-all">
          Add to <code>~/.opencode/opencode.json</code>:{" "}
          <code>
            "plugin": ["file:///home/nowaker/projekty/webapps/portal/packages/openportal-companion-plugin"]
          </code>
        </p>
        <p>
          Then restart your opencode-serve service so the plugin loads, and
          this panel will populate.
        </p>
      </div>
    );
  }

  const s = data.state!;
  const topTools = Object.entries(s.tools)
    .sort((a, b) => b[1].callCount - a[1].callCount)
    .slice(0, 8);
  const topEvents = Object.entries(s.events.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const sessionCount = Object.keys(s.sessions).length;

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-fg">
          Companion telemetry
          {data.stale && (
            <span className="ml-2 normal-case font-normal text-warning">
              (stale: last heartbeat {fmtAge(s.heartbeat.lastWriteAt)})
            </span>
          )}
        </h3>
        <span className="text-[10px] text-muted-fg/70 font-mono">
          v{s.identity.version}
        </span>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-fg">Loaded</dt>
        <dd>{fmtAge(s.identity.loadedAt)}</dd>
        <dt className="text-muted-fg">Heartbeat</dt>
        <dd>{fmtAge(s.heartbeat.lastWriteAt)}</dd>
        <dt className="text-muted-fg">Events seen</dt>
        <dd className="tabular-nums">{s.events.totalSeen.toLocaleString()}</dd>
        <dt className="text-muted-fg">Sessions tracked</dt>
        <dd className="tabular-nums">{sessionCount}</dd>
        <dt className="text-muted-fg">Permissions asked</dt>
        <dd className="tabular-nums">
          {s.permissions.totalAsked.toLocaleString()}
        </dd>
        <dt className="text-muted-fg">Compactions</dt>
        <dd className="tabular-nums">{s.compactions.total.toLocaleString()}</dd>
        <dt className="text-muted-fg">Tools observed</dt>
        <dd className="tabular-nums">{s.toolDefinitionsSeen.length}</dd>
        {s.identity.initError && (
          <>
            <dt className="text-danger">Init error</dt>
            <dd className="text-danger break-words">{s.identity.initError}</dd>
          </>
        )}
      </dl>

      {topTools.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-muted-fg mb-1">
            Top tools by call count
          </h4>
          <ul className="font-mono text-[11px] space-y-0.5">
            {topTools.map(([name, t]) => (
              <li key={name} className="flex items-center justify-between gap-2">
                <span className="truncate">{name}</span>
                <span className="text-muted-fg tabular-nums shrink-0">
                  {t.callCount}× · p50 {t.p50Ms ?? "—"}ms · p95 {t.p95Ms ?? "—"}ms · last {fmtAge(t.lastFiredAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topEvents.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-muted-fg mb-1">
            Top event types
          </h4>
          <ul className="font-mono text-[11px] space-y-0.5">
            {topEvents.map(([type, count]) => (
              <li key={type} className="flex items-center justify-between gap-2">
                <span className="truncate">{type}</span>
                <span className="text-muted-fg tabular-nums shrink-0">
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
