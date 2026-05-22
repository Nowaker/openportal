import { defineHandler } from "nitro/h3";
import { execSync } from "child_process";
import { readFileSync, statSync, statfsSync } from "fs";
import { cpus } from "node:os";
import { readPortalConfig } from "./lib/portal-config";

interface DiskStat {
  path: string;
  totalKb: number;
  availableKb: number;
  usedKb: number;
  usedPercent: number;
}

interface SystemStats {
  load: { one: number; five: number; fifteen: number } | null;
  memory: {
    totalKb: number;
    availableKb: number;
    usedKb: number;
    usedPercent: number;
  } | null;
  cpu: { totalPercent: number; iowaitPercent: number } | null;
  disks: DiskStat[];
  opencodeProcesses: Array<{
    pid: number;
    rssKb: number;
    cpuPercent: number;
    cmdline: string;
  }>;
  observedAt: number;
}

// /proc/stat cumulative jiffy counters since boot. Reading once gives
// you the average since boot which is useless for "is iowait high
// right now". Sample twice 100ms apart and compute the delta -
// matches what top/iostat do for instant iowait.
function readCpuStat(): {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
} | null {
  try {
    const raw = readFileSync("/proc/stat", "utf8");
    const line = raw.split("\n").find((l) => l.startsWith("cpu "));
    if (!line) return null;
    const parts = line.split(/\s+/).slice(1).map((x) => parseInt(x, 10));
    if (parts.some((n) => Number.isNaN(n))) return null;
    return {
      user: parts[0] ?? 0,
      nice: parts[1] ?? 0,
      system: parts[2] ?? 0,
      idle: parts[3] ?? 0,
      iowait: parts[4] ?? 0,
      irq: parts[5] ?? 0,
      softirq: parts[6] ?? 0,
      steal: parts[7] ?? 0,
    };
  } catch {
    return null;
  }
}

function sumJiffies(s: NonNullable<ReturnType<typeof readCpuStat>>): number {
  return (
    s.user + s.nice + s.system + s.idle + s.iowait + s.irq + s.softirq + s.steal
  );
}

// /proc/<pid>/stat fields after the (comm) blob: state, ppid, pgrp,
// session, tty_nr, tpgid, flags, minflt, cminflt, majflt, cmajflt,
// utime, stime. utime+stime is the CPU jiffies the process has
// consumed. The (comm) blob can contain spaces and parens; the safe
// parse splits on the LAST close-paren so anything before that
// position is ignored.
function readProcCpuJiffies(pid: number): number | null {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const lastParen = raw.lastIndexOf(")");
    if (lastParen < 0) return null;
    const tail = raw.slice(lastParen + 2).trim().split(/\s+/);
    const utime = parseInt(tail[11] ?? "0", 10);
    const stime = parseInt(tail[12] ?? "0", 10);
    if (Number.isNaN(utime) || Number.isNaN(stime)) return null;
    return utime + stime;
  } catch {
    return null;
  }
}

interface OpencodeProcLite {
  pid: number;
  cmdline: string;
}

function listOpencodeProcs(): OpencodeProcLite[] {
  try {
    const raw = execSync("pgrep -af 'opencode .* serve' 2>/dev/null", {
      encoding: "utf8",
      timeout: 1500,
    }).trim();
    if (!raw) return [];
    const out: OpencodeProcLite[] = [];
    for (const line of raw.split("\n")) {
      const space = line.indexOf(" ");
      if (space < 0) continue;
      const pid = parseInt(line.slice(0, space), 10);
      const cmdline = line.slice(space + 1).trim();
      if (!Number.isFinite(pid)) continue;
      const head = cmdline.split(/\s+/)[0] ?? "";
      if (!/(\/|^)opencode$/.test(head)) continue;
      out.push({ pid, cmdline });
    }
    return out;
  } catch {
    return [];
  }
}

function readRssKb(pid: number): number {
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, "utf8").trim();
    const rssPages = parseInt(statm.split(/\s+/)[1] ?? "0", 10);
    return rssPages * 4;
  } catch {
    return 0;
  }
}

interface SampledStats {
  iowaitPercent: number | null;
  cpuPercent: number | null;
  opencodeProcesses: SystemStats["opencodeProcesses"];
}

// Single delta-sampling pass that computes iowait + total CPU%
// (overall, derived from idle-jiffies delta) + per-opencode-process
// CPU% (derived from /proc/<pid>/stat utime+stime delta against the
// system jiffies delta scaled by core count, so a process pegging
// one core renders as 100% in a top-style display). One 100ms sleep
// covers all three samples - the broken old path called `top -b -n 1`
// per process which always returned 0% (top needs prior history to
// compute a delta and the single-iteration mode has none).
async function sampleStats(): Promise<SampledStats> {
  const procs = listOpencodeProcs();
  const numCpus = cpus().length || 1;
  const sysA = readCpuStat();
  const procA = procs.map((p) => readProcCpuJiffies(p.pid));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const sysB = readCpuStat();
  const procB = procs.map((p) => readProcCpuJiffies(p.pid));
  if (!sysA || !sysB) {
    return {
      iowaitPercent: null,
      cpuPercent: null,
      opencodeProcesses: procs.map((p) => ({
        pid: p.pid,
        rssKb: readRssKb(p.pid),
        cpuPercent: 0,
        cmdline: p.cmdline,
      })),
    };
  }
  const sysDelta = sumJiffies(sysB) - sumJiffies(sysA);
  if (sysDelta <= 0) {
    return {
      iowaitPercent: 0,
      cpuPercent: 0,
      opencodeProcesses: procs.map((p) => ({
        pid: p.pid,
        rssKb: readRssKb(p.pid),
        cpuPercent: 0,
        cmdline: p.cmdline,
      })),
    };
  }
  const iowaitDelta = sysB.iowait - sysA.iowait;
  const idleDelta = sysB.idle - sysA.idle;
  const iowaitPercent = Math.max(
    0,
    Math.min(100, (iowaitDelta / sysDelta) * 100),
  );
  const cpuPercent = Math.max(
    0,
    Math.min(100, ((sysDelta - idleDelta) / sysDelta) * 100),
  );
  const opencodeProcesses = procs.map((p, i) => {
    const a = procA[i];
    const b = procB[i];
    let pcpu = 0;
    if (a !== null && b !== null) {
      const procDelta = b - a;
      pcpu = Math.max(0, (procDelta / sysDelta) * 100 * numCpus);
    }
    return {
      pid: p.pid,
      rssKb: readRssKb(p.pid),
      cpuPercent: pcpu,
      cmdline: p.cmdline,
    };
  });
  return { iowaitPercent, cpuPercent, opencodeProcesses };
}

function readLoadavg(): SystemStats["load"] {
  try {
    const raw = readFileSync("/proc/loadavg", "utf8").trim();
    const parts = raw.split(/\s+/);
    if (parts.length < 3) return null;
    const [one, five, fifteen] = parts.map((x) => parseFloat(x));
    if ([one, five, fifteen].some((n) => Number.isNaN(n))) return null;
    return { one, five, fifteen };
  } catch {
    return null;
  }
}

function readMeminfo(): SystemStats["memory"] {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const lines = raw.split("\n");
    let totalKb = 0;
    let availableKb = 0;
    for (const line of lines) {
      if (line.startsWith("MemTotal:")) {
        totalKb = parseInt(line.split(/\s+/)[1] ?? "0", 10);
      } else if (line.startsWith("MemAvailable:")) {
        availableKb = parseInt(line.split(/\s+/)[1] ?? "0", 10);
      }
    }
    if (!totalKb) return null;
    const usedKb = Math.max(0, totalKb - availableKb);
    const usedPercent = Math.round((usedKb / totalKb) * 100);
    return { totalKb, availableKb, usedKb, usedPercent };
  } catch {
    return null;
  }
}

function longestCommonRoot(paths: string[]): string {
  if (paths.length === 0) return "/";
  const split = paths.map((p) => p.split("/").filter((s) => s.length > 0));
  if (split.length === 1) return "/" + split[0].join("/");
  const minLen = Math.min(...split.map((s) => s.length));
  let commonLen = 0;
  for (let i = 0; i < minLen; i++) {
    const seg = split[0][i];
    if (split.every((s) => s[i] === seg)) commonLen++;
    else break;
  }
  if (commonLen === 0) return "/";
  return "/" + split[0].slice(0, commonLen).join("/");
}

function statfsToDisk(path: string): DiskStat | null {
  try {
    const s = statfsSync(path);
    const totalBytes = s.bsize * s.blocks;
    const availBytes = s.bsize * s.bavail;
    const usedBytes = Math.max(0, totalBytes - availBytes);
    if (totalBytes === 0) return null;
    const usedPercent = Math.round((usedBytes / totalBytes) * 100);
    return {
      path,
      totalKb: Math.round(totalBytes / 1024),
      availableKb: Math.round(availBytes / 1024),
      usedKb: Math.round(usedBytes / 1024),
      usedPercent,
    };
  } catch {
    return null;
  }
}

function readDiskStats(): DiskStat[] {
  let configuredDirs: string[];
  try {
    configuredDirs = readPortalConfig().directories;
  } catch {
    return [];
  }
  if (configuredDirs.length === 0) return [];

  const byDev = new Map<number, string[]>();
  for (const dir of configuredDirs) {
    try {
      const s = statSync(dir);
      const list = byDev.get(s.dev) ?? [];
      list.push(dir);
      byDev.set(s.dev, list);
    } catch {
      /* dir doesn't exist on disk - skip */
    }
  }
  if (byDev.size === 0) return [];

  if (byDev.size === 1) {
    const dirsOnFs = Array.from(byDev.values())[0];
    const root = longestCommonRoot(dirsOnFs);
    const stat = statfsToDisk(root);
    return stat ? [stat] : [];
  }

  const out: DiskStat[] = [];
  for (const dirsOnFs of byDev.values()) {
    const root = longestCommonRoot(dirsOnFs);
    const stat = statfsToDisk(root);
    if (stat) out.push(stat);
  }
  return out;
}

export default defineHandler(async () => {
  const sampled = await sampleStats();
  const stats: SystemStats = {
    load: readLoadavg(),
    memory: readMeminfo(),
    cpu:
      sampled.cpuPercent === null && sampled.iowaitPercent === null
        ? null
        : {
            totalPercent: sampled.cpuPercent ?? 0,
            iowaitPercent: sampled.iowaitPercent ?? 0,
          },
    disks: readDiskStats(),
    opencodeProcesses: sampled.opencodeProcesses,
    observedAt: Date.now(),
  };
  return stats;
});
