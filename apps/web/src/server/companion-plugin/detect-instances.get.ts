import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineHandler } from "nitro/h3";

interface DetectedInstance {
  pid: number;
  hostname: string | null;
  port: number | null;
  systemdUnit: string | null;
  scope: "user" | "system" | "unknown";
  cmdline: string;
}

function readCgroupUnit(pid: number): {
  scope: "user" | "system" | "unknown";
  systemdUnit: string | null;
} {
  try {
    const cgroup = readFileSync(`/proc/${pid}/cgroup`, "utf-8").trim();
    const userMatch = cgroup.match(
      /\/user\.slice\/[^/]+\/[^/]*?(?<unit>[\w@.-]+\.service)/,
    );
    if (userMatch?.groups?.unit) {
      return { scope: "user", systemdUnit: userMatch.groups.unit };
    }
    const sysMatch = cgroup.match(/\/system\.slice\/[^/]*?([\w@.-]+\.service)/);
    if (sysMatch?.[1]) {
      return { scope: "system", systemdUnit: sysMatch[1] };
    }
  } catch {
    // /proc/<pid>/cgroup is the source of truth - if it's gone, the process exited
    // between pgrep and read. Returning unknown lets the UI hide it from restart actions.
  }
  return { scope: "unknown", systemdUnit: null };
}

function parseHostnamePort(cmdline: string): {
  hostname: string | null;
  port: number | null;
} {
  const hostMatch = cmdline.match(/--hostname[=\s]+(\S+)/);
  const portMatch = cmdline.match(/--port[=\s]+(\d+)/);
  return {
    hostname: hostMatch?.[1] ?? null,
    port: portMatch ? Number(portMatch[1]) : null,
  };
}

export default defineHandler(() => {
  let raw = "";
  try {
    raw = execSync("pgrep -af 'opencode serve'", {
      encoding: "utf-8",
      timeout: 2000,
    });
  } catch {
    return { instances: [] };
  }

  const instances: DetectedInstance[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmdline = m[2];
    if (!cmdline.includes("opencode")) continue;
    const { hostname, port } = parseHostnamePort(cmdline);
    const { scope, systemdUnit } = readCgroupUnit(pid);
    instances.push({ pid, hostname, port, systemdUnit, scope, cmdline });
  }
  return { instances };
});
