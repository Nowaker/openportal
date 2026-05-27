import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/solid";
import { useInstanceStore } from "@/stores/instance-store";
import { useSystemStats } from "@/stores/system-stats-store";
import { useCohort } from "@/stores/cohort-store";
import { useSidebarStatsExpandStore } from "@/stores/sidebar-stats-expand-store";

type Tone = "neutral" | "warning" | "danger";

// Metric is the unified shape rendered by both the collapsed row and the
// expanded grid. Collapsed mode uses `short` + `value` (two lines per cell);
// expanded mode uses `label` + `value` + optional bar + optional sub/detail.
interface Metric {
  key: string;
  short: string;
  label: string;
  value: string;
  percent: number | null;
  tone: Tone;
  sub?: string;
  detail?: string;
  title?: string;
}

function formatSize(kb: number): string {
  if (kb >= 1024 * 1024 * 1024)
    return `${(kb / (1024 * 1024 * 1024)).toFixed(1)} TB`;
  if (kb >= 1024 * 1024)
    return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

// Compact short-form for sidebar fit. Thresholds match the user spec
// in dispatch ITEM 2: <1s ok, 1-5s warning, 5-30s amber, >30s red.
function formatLag(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

function lagTone(ms: number): Tone {
  if (ms >= 30_000) return "danger";
  if (ms >= 1_000) return "warning";
  return "neutral";
}

function lagTitle(ms: number | null): string {
  if (ms === null) return "No opencode SSE traffic observed yet.";
  if (ms >= 30_000)
    return "opencode SSE pipeline saturated or stuck (no event in >30s).";
  if (ms >= 5_000) return "opencode SSE pipeline lagging (no event in >5s).";
  if (ms >= 1_000) return "opencode SSE pipeline mildly behind.";
  return "opencode SSE pipeline fresh.";
}

function toneText(tone: Tone): string {
  if (tone === "danger") return "text-danger";
  if (tone === "warning") return "text-warning";
  return "text-fg";
}

function toneBar(tone: Tone): string {
  if (tone === "danger") return "bg-danger";
  if (tone === "warning") return "bg-warning";
  return "bg-accent";
}

function pct(n: number): string {
  return `${Math.round(Math.max(0, Math.min(100, n)))}%`;
}

export function SidebarSystemStats() {
  const { stats, isLoading } = useSystemStats();
  const { cohort } = useCohort();
  const activePort = useInstanceStore((s) => s.instance?.port ?? null);
  const activeHostname = useInstanceStore((s) => s.instance?.hostname ?? null);
  const expanded = useSidebarStatsExpandStore((s) => s.expanded);
  const toggle = useSidebarStatsExpandStore((s) => s.toggle);

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
  // "Expected" CPU = load1/cores * 100. Always derived from load1 so it
  // surfaces the 1-minute trend even when totalPercent is also available
  // (otherwise the two values would never disagree).
  const expectedCpuPercent = stats.load
    ? Math.min(100, (stats.load.one / cores) * 100)
    : null;
  const cpuTone: Tone =
    cpuPercent >= 90 ? "danger" : cpuPercent >= 70 ? "warning" : "neutral";

  const memPercent = stats.memory?.usedPercent ?? 0;
  const memTone: Tone =
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
      if (
        activeHostname &&
        !p.cmdline.includes(`--hostname ${activeHostname}`)
      ) {
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

  // Cohort partitioning: an opencode process belongs to the user's
  // current cohort iff its --port flag matches a worker reported by
  // the cohort plugin at /api/cohort. The plugin is authoritative for
  // cohort membership (every worker registered to the same plugin
  // leader shares a DB by construction).
  const cohortPorts = new Set(cohort.workers.map((w) => w.port));
  const cohortProcesses = stats.opencodeProcesses.filter((p) => {
    const m = p.cmdline.match(/--port\s+(\d+)/);
    if (m) return cohortPorts.has(parseInt(m[1], 10));
    return cohortPorts.has(4096);
  });
  const cohortRssKb = cohortProcesses.reduce((sum, p) => sum + p.rssKb, 0);
  const cohortCpu = cohortProcesses.reduce((sum, p) => sum + p.cpuPercent, 0);
  const cohortMemPercent =
    memTotalKb > 0 ? (cohortRssKb / memTotalKb) * 100 : 0;
  const showCohort = cohort.pluginReachable && cohortProcesses.length > 0;

  // Host-total fallback: only when cohort partitioning is unavailable
  // (plugin unreachable) AND there are opencode processes. "Other ocs"
  // (cohort-reachable but-not-in-cohort processes) was dropped per the
  // user's spec - the user found it irrelevant noise.
  const allRssKb = stats.opencodeProcesses.reduce((sum, p) => sum + p.rssKb, 0);
  const allCpu = stats.opencodeProcesses.reduce(
    (sum, p) => sum + p.cpuPercent,
    0,
  );
  const allMemPercent = memTotalKb > 0 ? (allRssKb / memTotalKb) * 100 : 0;
  const allCount = stats.opencodeProcesses.length;
  const showAllOcs = !cohort.pluginReachable && allCount > 0;

  // SSE pipeline freshness: worst-case lag across all known opencodes.
  const lagMs = stats.sseLatency?.worstLagMs ?? null;

  // Build metric list in priority order. Lower-priority cells get hidden
  // first when the collapsed row runs out of horizontal space.
  const metrics: Metric[] = [];

  metrics.push({
    key: "cpu",
    short: "CPU",
    label: "CPU",
    value: pct(cpuPercent),
    percent: cpuPercent,
    tone: cpuTone,
    sub:
      expectedCpuPercent !== null
        ? `expected ${pct(expectedCpuPercent)} (of ${cores} core${cores === 1 ? "" : "s"})`
        : undefined,
  });

  if (stats.memory) {
    metrics.push({
      key: "mem",
      short: "MEM",
      label: "Memory",
      value: `${stats.memory.usedPercent}%`,
      percent: memPercent,
      tone: memTone,
      detail: `${formatSize(stats.memory.usedKb)} / ${formatSize(stats.memory.totalKb)}`,
    });
  }

  for (const d of stats.disks) {
    const tone: Tone =
      d.usedPercent >= 95
        ? "danger"
        : d.usedPercent >= 85
          ? "warning"
          : "neutral";
    const isOnlyDisk = stats.disks.length === 1;
    metrics.push({
      key: `disk-${d.path}`,
      short: "SPC",
      label: isOnlyDisk ? "Disk" : `Disk ${d.path}`,
      value: `${d.usedPercent}%`,
      percent: d.usedPercent,
      tone,
      detail: `${formatSize(d.usedKb)} / ${formatSize(d.totalKb)}`,
      title: isOnlyDisk ? undefined : `Filesystem rooted at ${d.path}`,
    });
  }

  metrics.push({
    key: "sse",
    short: "LAT",
    label: "SSE latency",
    value: lagMs === null ? "—" : formatLag(lagMs),
    percent: null,
    tone: lagMs === null ? "neutral" : lagTone(lagMs),
    title: lagTitle(lagMs),
  });

  if (stats.cpu) {
    const iow = stats.cpu.iowaitPercent;
    const tone: Tone =
      iow >= 30 ? "danger" : iow >= 10 ? "warning" : "neutral";
    metrics.push({
      key: "iowait",
      short: "IOW",
      label: "I/O wait",
      value: pct(iow),
      percent: iow,
      tone,
    });
  }

  if (currentProcess) {
    metrics.push({
      key: "oc-active",
      short: "OC",
      label: "Active OpenCode",
      value: pct(currentMemPercent),
      percent: currentMemPercent,
      tone: "neutral",
      detail: `${formatSize(currentProcess.rssKb)}, ${Math.round(currentProcess.cpuPercent)}% CPU`,
    });
  }

  if (showCohort) {
    metrics.push({
      key: "oc-cohort",
      short: "COH",
      label: `Cohort (×${cohortProcesses.length})`,
      value: pct(cohortMemPercent),
      percent: cohortMemPercent,
      tone: "neutral",
      detail: `${formatSize(cohortRssKb)}, ${Math.round(cohortCpu)}% CPU`,
    });
  }

  if (showAllOcs) {
    metrics.push({
      key: "oc-all",
      short: "OCS",
      label: `OpenCodes on host (×${allCount})`,
      value: pct(allMemPercent),
      percent: allMemPercent,
      tone: "neutral",
      detail: `${formatSize(allRssKb)}, ${Math.round(allCpu)}% CPU`,
    });
  }

  return (
    <div
      className="in-data-[collapsible=dock]:hidden"
      data-test="portal-sidebar-system-stats"
    >
      {expanded ? (
        <ExpandedView metrics={metrics} onCollapse={toggle} />
      ) : (
        <CollapsedView metrics={metrics} onExpand={toggle} />
      )}
    </div>
  );
}

// Horizontal-row "glance" view. All cells render, but a ResizeObserver
// computes how many fit and the overflow tail is hidden with display:none
// (priority order = metric list order = CPU first, then MEM, SPC, LAT,
// IOW, OC, COH, OCS). Cell widths are roughly uniform (3-char acronym +
// short numeric value), so a fixed-width-per-cell heuristic is good
// enough - no per-cell measurement needed.
function CollapsedView({
  metrics,
  onExpand,
}: {
  metrics: Metric[];
  onExpand: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(metrics.length);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Empirical: CPU/MEM/SPC/LAT/IOW cells render at ~50px natural width
    // with `flex: 1` they grow uniformly. 52px is the min before "11%"
    // starts looking cramped next to the acronym.
    const CELL_MIN_WIDTH = 52;
    const GAP = 4;
    const CHEVRON_AREA = 32;

    function measure() {
      if (!container) return;
      const containerWidth = container.clientWidth;
      const available = containerWidth - CHEVRON_AREA;
      const count = Math.max(
        1,
        Math.floor((available + GAP) / (CELL_MIN_WIDTH + GAP)),
      );
      setVisibleCount(Math.min(metrics.length, count));
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [metrics.length]);

  return (
    <div
      ref={containerRef}
      className="flex items-stretch gap-1 px-2 py-1.5"
    >
      <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-hidden">
        {metrics.slice(0, visibleCount).map((m) => (
          <CollapsedCell key={m.key} metric={m} />
        ))}
      </div>
      <button
        type="button"
        onClick={onExpand}
        title="Show full resources panel"
        aria-label="Expand resources panel"
        aria-expanded={false}
        data-test="portal-sidebar-system-stats-toggle"
        className="flex shrink-0 items-center justify-center rounded p-1 text-muted-fg hover:bg-muted hover:text-fg"
      >
        <ChevronUpIcon className="size-4" />
      </button>
    </div>
  );
}

function CollapsedCell({ metric }: { metric: Metric }) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-sm bg-muted/40 px-1 py-0.5 leading-tight"
      title={metric.title ?? `${metric.label}: ${metric.value}`}
      data-test={`portal-sidebar-stats-cell-${metric.key}`}
    >
      <span className="text-[9px] uppercase tracking-wide text-muted-fg">
        {metric.short}
      </span>
      <span
        className={`text-[11px] font-medium tabular-nums ${toneText(metric.tone)}`}
      >
        {metric.value}
      </span>
    </div>
  );
}

// Detailed 2-column grid view. One cell per metric, with label/value
// header, optional %bar, optional subtitle (e.g. CPU expected/cores),
// and optional detail line (e.g. memory total, process RSS+CPU).
function ExpandedView({
  metrics,
  onCollapse,
}: {
  metrics: Metric[];
  onCollapse: () => void;
}) {
  return (
    <div className="space-y-1.5 px-2 py-1.5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {metrics.map((m) => (
          <ExpandedCell key={m.key} metric={m} />
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse resources panel"
          aria-label="Collapse resources panel"
          aria-expanded={true}
          data-test="portal-sidebar-system-stats-toggle"
          className="flex shrink-0 items-center justify-center rounded p-1 text-muted-fg hover:bg-muted hover:text-fg"
        >
          <ChevronDownIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

function ExpandedCell({ metric }: { metric: Metric }) {
  const hasBar = metric.percent !== null;
  return (
    <div
      className="min-w-0 space-y-0.5"
      title={metric.title}
      data-test={`portal-sidebar-stats-row-${metric.key}`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="truncate text-[10px] text-muted-fg">
          {metric.label}
        </span>
        <span
          className={`shrink-0 text-[10px] tabular-nums ${toneText(metric.tone)}`}
        >
          {metric.value}
        </span>
      </div>
      {hasBar && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${toneBar(metric.tone)} transition-all duration-300`}
            style={{
              width: `${Math.max(0, Math.min(100, metric.percent!))}%`,
            }}
          />
        </div>
      )}
      {metric.sub && (
        <div className="text-[9px] leading-tight text-muted-fg">
          {metric.sub}
        </div>
      )}
      {metric.detail && (
        <div className="truncate text-[9px] leading-tight text-muted-fg">
          {metric.detail}
        </div>
      )}
    </div>
  );
}
