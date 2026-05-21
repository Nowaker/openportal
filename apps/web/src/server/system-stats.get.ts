import { defineHandler } from "nitro/h3";
import { execSync } from "child_process";
import { readFileSync } from "fs";

interface SystemStats {
  load: { one: number; five: number; fifteen: number } | null;
  memory: {
    totalKb: number;
    availableKb: number;
    usedKb: number;
    usedPercent: number;
  } | null;
  opencodeProcesses: Array<{
    pid: number;
    rssKb: number;
    cpuPercent: number;
    cmdline: string;
  }>;
  observedAt: number;
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

function readOpencodeProcesses(): SystemStats["opencodeProcesses"] {
  try {
    const raw = execSync("pgrep -af 'opencode .* serve' 2>/dev/null", {
      encoding: "utf8",
      timeout: 1500,
    }).trim();
    if (!raw) return [];
    const out: SystemStats["opencodeProcesses"] = [];
    for (const line of raw.split("\n")) {
      const space = line.indexOf(" ");
      if (space < 0) continue;
      const pid = parseInt(line.slice(0, space), 10);
      const cmdline = line.slice(space + 1).trim();
      if (!Number.isFinite(pid)) continue;
      const head = cmdline.split(/\s+/)[0] ?? "";
      if (!/(\/|^)opencode$/.test(head)) continue;
      let rssKb = 0;
      let cpuPercent = 0;
      try {
        const statm = readFileSync(`/proc/${pid}/statm`, "utf8").trim();
        const rssPages = parseInt(statm.split(/\s+/)[1] ?? "0", 10);
        rssKb = rssPages * 4;
      } catch {
        /* process disappeared between pgrep and read - skip */
      }
      try {
        const top = execSync(
          `top -b -n 1 -p ${pid} 2>/dev/null | tail -1`,
          { encoding: "utf8", timeout: 1500 },
        ).trim();
        const cols = top.split(/\s+/).filter(Boolean);
        if (cols[0] === String(pid)) {
          const cpu = parseFloat(cols[8] ?? "0");
          if (!Number.isNaN(cpu)) cpuPercent = cpu;
        }
      } catch {
        /* top not available or process gone */
      }
      out.push({ pid, rssKb, cpuPercent, cmdline });
    }
    return out;
  } catch {
    return [];
  }
}

export default defineHandler(() => {
  const stats: SystemStats = {
    load: readLoadavg(),
    memory: readMeminfo(),
    opencodeProcesses: readOpencodeProcesses(),
    observedAt: Date.now(),
  };
  return stats;
});
