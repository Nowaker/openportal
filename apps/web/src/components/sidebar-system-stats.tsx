import { useInstanceStore } from "@/stores/instance-store";
import { useSystemStats } from "@/stores/system-stats-store";

function formatSize(kb: number): string {
  if (kb >= 1024 * 1024 * 1024)
    return `${(kb / (1024 * 1024 * 1024)).toFixed(1)} TB`;
  if (kb >= 1024 * 1024)
    return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
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
  const activePort = useInstanceStore((s) => s.instance?.port ?? null);
  const activeHostname = useInstanceStore((s) => s.instance?.hostname ?? null);
  if (isLoading && !stats.load) return null;
  if (!stats.load && !stats.memory) return null;

  // Prefer server-computed total CPU% (delta-sampled /proc/stat
  // idle vs total jiffies) over load1/cores which can lag behind
  // the actual instantaneous workload. Fall back to load1/cores
  // when the sampler returns null (kernel didn't provide /proc/stat).
  const cores =
    typeof navigator !== "undefined"
      ? Math.max(1, navigator.hardwareConcurrency || 1)
      : 1;
  const cpuPercent =
    stats.cpu?.totalPercent ??
    (stats.load ? Math.min(100, (stats.load.one / cores) * 100) : 0);
  const cpuTone =
    cpuPercent >= 90 ? "danger" : cpuPercent >= 70 ? "warning" : "neutral";
  const memPercent = stats.memory?.usedPercent ?? 0;
  const memTone =
    memPercent >= 90 ? "danger" : memPercent >= 80 ? "warning" : "neutral";
  const memTotalKb = stats.memory?.totalKb ?? 0;

  // Identify the opencode the portal is connected to. opencode's
  // cmdline carries `--hostname <ip>` and may or may not carry
  // `--port <N>` (default 4096 is implicit, only non-defaults are
  // explicit). Match on whichever signals are available, preferring
  // hostname when several processes share the default port.
  const currentProcess = (() => {
    if (!activePort && !activeHostname) return null;
    const candidates = stats.opencodeProcesses.filter((p) => {
      if (activePort) {
        const explicit = p.cmdline.includes(`--port ${activePort}`);
        const implicitDefault =
          activePort === 4096 && !p.cmdline.includes("--port ");
        if (!explicit && !implicitDefault) return false;
      }
      if (activeHostname && !p.cmdline.includes(`--hostname ${activeHostname}`)) {
        return false;
      }
      return true;
    });
    return candidates[0] ?? null;
  })();
  const currentMemPercent =
    currentProcess && memTotalKb > 0
      ? (currentProcess.rssKb / memTotalKb) * 100
      : 0;

  const totalOpencodeRssKb = stats.opencodeProcesses.reduce(
    (sum, p) => sum + p.rssKb,
    0,
  );
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
        label="cpu"
        percent={cpuPercent}
        detail={`${Math.round(cpuPercent)}%`}
        tone={cpuTone}
      />
      <Bar
        label="ram"
        percent={memPercent}
        detail={
          stats.memory
            ? `${stats.memory.usedPercent}% (${formatSize(stats.memory.usedKb)})`
            : "—"
        }
        tone={memTone}
      />
      {stats.cpu && (
        <Bar
          label="iowait"
          percent={stats.cpu.iowaitPercent}
          detail={`${Math.round(stats.cpu.iowaitPercent)}%`}
          tone={
            stats.cpu.iowaitPercent >= 30
              ? "danger"
              : stats.cpu.iowaitPercent >= 10
                ? "warning"
                : "neutral"
          }
        />
      )}
      {stats.disks.map((d, i) => {
        const label = stats.disks.length === 1 ? "disk" : `disk ${d.path}`;
        return (
          <Bar
            key={`${d.path}-${i}`}
            label={label}
            percent={d.usedPercent}
            detail={`${d.usedPercent}% (${formatSize(d.usedKb)} / ${formatSize(d.totalKb)})`}
            tone={
              d.usedPercent >= 95
                ? "danger"
                : d.usedPercent >= 85
                  ? "warning"
                  : "neutral"
            }
          />
        );
      })}
      {currentProcess && (
        <Bar
          label="this oc"
          percent={currentMemPercent}
          detail={`${formatSize(currentProcess.rssKb)}, ${Math.round(currentProcess.cpuPercent)}% CPU`}
          tone="neutral"
        />
      )}
      {stats.opencodeProcesses.length > 0 && (
        <Bar
          label={`all ocs×${stats.opencodeProcesses.length}`}
          percent={opencodeMemPercent}
          detail={`${formatSize(totalOpencodeRssKb)}, ${Math.round(totalOpencodeCpu)}% CPU`}
          tone="neutral"
        />
      )}
      <SseLatencyRow worstLagMs={stats.sseLatency?.worstLagMs ?? null} />
    </div>
  );
}

// Compact short-form for sidebar fit. Thresholds match the user spec
// in the dispatch (ITEM 2): <1s ok, 1-5s warning, 5-30s amber, >30s red.
function formatLag(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

function lagTone(ms: number): "neutral" | "warning" | "danger" {
  if (ms >= 30_000) return "danger";
  if (ms >= 1_000) return "warning";
  return "neutral";
}

// Single SSE-freshness row. 'null' worstLag = no SSE traffic ever
// observed by this openportal process (just started, or no opencodes
// configured). Render dash + neutral tone in that case rather than
// claiming '0ms' which would imply 'connected and fresh'.
function SseLatencyRow({ worstLagMs }: { worstLagMs: number | null }) {
  const ms = worstLagMs;
  const detail = ms === null ? "—" : formatLag(ms);
  const tone = ms === null ? "neutral" : lagTone(ms);
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : "text-muted-fg";
  return (
    <div
      className="flex justify-between text-[10px]"
      data-test="portal-sidebar-sse-latency"
      title={
        ms === null
          ? "No opencode SSE traffic observed yet."
          : ms >= 30_000
            ? "opencode SSE pipeline saturated or stuck (no event in >30s)."
            : ms >= 5_000
              ? "opencode SSE pipeline lagging (no event in >5s)."
              : ms >= 1_000
                ? "opencode SSE pipeline mildly behind."
                : "opencode SSE pipeline fresh."
      }
    >
      <span className={toneClass}>sse</span>
      <span className={`tabular-nums ${toneClass}`}>{detail}</span>
    </div>
  );
}


