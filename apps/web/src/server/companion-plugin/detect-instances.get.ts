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
    // /proc/<pid>/cgroup looks like:
    //   0::/user.slice/user-1000.slice/user@1000.service/app.slice/opencode-serve-lan.service
    // The LAST .service segment is the unit that actually owns this pid;
    // anchoring on the trailing segment avoids capturing the user@<uid>.service
    // wrapper that lives further up the path.
    const segments = cgroup.split("/").filter((s) => s.endsWith(".service"));
    const leaf = segments[segments.length - 1] ?? null;
    if (!leaf || leaf.startsWith("user@")) {
      return { scope: "unknown", systemdUnit: null };
    }
    if (cgroup.includes("/user.slice/")) {
      return { scope: "user", systemdUnit: leaf };
    }
    if (cgroup.includes("/system.slice/")) {
      return { scope: "system", systemdUnit: leaf };
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
