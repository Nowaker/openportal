import { useSystemStats } from "@/stores/system-stats-store";

function formatRss(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} kB`;
}

function Bar({
  label,
  percent,
  detail,
  tone,
}: {
  label: string;
  percent: number;
  detail: string;
  tone: "neutral" | "warning" | "danger";
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const barClass =
    tone === "danger"
      ? "bg-danger"
      : tone === "warning"
        ? "bg-warning"
        : "bg-accent";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-muted-fg">
        <span>{label}</span>
        <span className="tabular-nums">{detail}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${barClass} transition-all duration-300`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function SidebarSystemStats() {
  const { stats, isLoading } = useSystemStats();
  if (isLoading && !stats.load) return null;
  if (!stats.load && !stats.memory) return null;

  const cores =
    typeof navigator !== "undefined"
      ? Math.max(1, navigator.hardwareConcurrency || 1)
      : 1;
  const loadPercent = stats.load
    ? Math.min(100, (stats.load.one / cores) * 100)
    : 0;
  const loadTone =
    loadPercent >= 90 ? "danger" : loadPercent >= 70 ? "warning" : "neutral";
  const memPercent = stats.memory?.usedPercent ?? 0;
  const memTone =
    memPercent >= 90 ? "danger" : memPercent >= 80 ? "warning" : "neutral";
  const totalOpencodeRssKb = stats.opencodeProcesses.reduce(
    (sum, p) => sum + p.rssKb,
    0,
  );
  const memTotalKb = stats.memory?.totalKb ?? 0;
  const opencodeMemPercent =
    memTotalKb > 0 ? (totalOpencodeRssKb / memTotalKb) * 100 : 0;
  const totalOpencodeCpu = stats.opencodeProcesses.reduce(
    (sum, p) => sum + p.cpuPercent,
    0,
  );

  return (
    <div
      className="space-y-1.5 px-2 py-1.5 in-data-[collapsible=dock]:hidden"
      data-test="portal-sidebar-system-stats"
    >
      <Bar
        label="Load"
        percent={loadPercent}
        detail={
          stats.load
            ? `${stats.load.one.toFixed(2)} (${cores}c)`
            : "—"
        }
        tone={loadTone}
      />
      <Bar
        label="Memory"
        percent={memPercent}
        detail={
          stats.memory
            ? `${stats.memory.usedPercent}% (${formatRss(stats.memory.usedKb)})`
            : "—"
        }
        tone={memTone}
      />
      {stats.opencodeProcesses.length > 0 && (
        <Bar
          label={`OpenCode×${stats.opencodeProcesses.length}`}
          percent={opencodeMemPercent}
          detail={`${formatRss(totalOpencodeRssKb)}, ${totalOpencodeCpu.toFixed(0)}% CPU`}
          tone="neutral"
        />
      )}
    </div>
  );
}
