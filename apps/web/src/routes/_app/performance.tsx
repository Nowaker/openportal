import { createFileRoute } from "@tanstack/react-router";

import { useSystemStats } from "@/stores/system-stats-store";
import { PageTitle } from "@/components/ui/typography";
import { Loader } from "@/components/ui/loader";

export const Route = createFileRoute("/_app/performance")({
  component: PerformancePage,
});

function formatRss(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} kB`;
}

function PerformancePage() {
  const { stats, isLoading } = useSystemStats(5000);

  const cores =
    typeof navigator !== "undefined"
      ? Math.max(1, navigator.hardwareConcurrency || 1)
      : 1;

  if (isLoading && !stats.load) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader className="size-6" />
      </div>
    );
  }

  const sortedProcs = [...stats.opencodeProcesses].sort(
    (a, b) => b.rssKb - a.rssKb,
  );

  return (
    <div
      className="flex-1 min-h-0 overflow-auto p-4 sm:p-6"
      data-test="portal-performance-page"
    >
      <PageTitle>Performance</PageTitle>

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Load (1m)" value={stats.load ? stats.load.one.toFixed(2) : "—"} sub={`/ ${cores} cores`} />
        <StatCard label="Load (5m)" value={stats.load ? stats.load.five.toFixed(2) : "—"} sub="" />
        <StatCard label="Load (15m)" value={stats.load ? stats.load.fifteen.toFixed(2) : "—"} sub="" />
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Memory</h2>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Used"
            value={stats.memory ? `${stats.memory.usedPercent}%` : "—"}
            sub={stats.memory ? formatRss(stats.memory.usedKb) : ""}
          />
          <StatCard
            label="Available"
            value={stats.memory ? formatRss(stats.memory.availableKb) : "—"}
            sub=""
          />
          <StatCard
            label="Total"
            value={stats.memory ? formatRss(stats.memory.totalKb) : "—"}
            sub=""
          />
        </div>
        {stats.memory && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all duration-300 ${
                stats.memory.usedPercent >= 90
                  ? "bg-danger"
                  : stats.memory.usedPercent >= 80
                    ? "bg-warning"
                    : "bg-accent"
              }`}
              style={{ width: `${stats.memory.usedPercent}%` }}
            />
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">
          OpenCode processes ({sortedProcs.length})
        </h2>
        {sortedProcs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-fg">
            No OpenCode processes running.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-fg">
                  <th className="px-2 py-1.5">PID</th>
                  <th className="px-2 py-1.5">RSS</th>
                  <th className="px-2 py-1.5">CPU %</th>
                  <th className="px-2 py-1.5">Cmdline</th>
                </tr>
              </thead>
              <tbody>
                {sortedProcs.map((p) => (
                  <tr
                    key={p.pid}
                    className="border-b border-border/30 hover:bg-muted/30"
                    data-test={`portal-performance-proc-${p.pid}`}
                  >
                    <td className="px-2 py-1.5 font-mono tabular-nums">
                      {p.pid}
                    </td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">
                      {formatRss(p.rssKb)}
                    </td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">
                      {p.cpuPercent.toFixed(1)}%
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-fg break-all">
                      <code className="font-mono">{p.cmdline}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-muted-fg">
        Refreshes every 5 seconds. Data via /api/system-stats (reads
        /proc/loadavg + /proc/meminfo + /proc/&lt;pid&gt;/statm).
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="text-xs text-muted-fg">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-fg">{sub}</div>}
    </div>
  );
}
