import { execSync } from "node:child_process";

export type ServiceScope = "user" | "system" | "unknown";

export interface OpencodeServiceInfo {
  scope: ServiceScope;
  unitName: string | null;
  opencodePid: number | null;
  detectionNotes: string[];
}

// Walks pid -> cgroup -> systemd unit so the caller knows exactly which
// service backs the opencode listening on a given hostname:port pair.
// Falls back gracefully when the process is not under systemd at all
// (e.g. a developer running `opencode serve` from a terminal): unitName
// stays null, the caller surfaces a manual-restart instruction instead
// of attempting a noop systemctl call.
export function detectOpencodeService(
  hostname: string,
  port: number,
): OpencodeServiceInfo {
  const notes: string[] = [];
  let opencodePid: number | null = null;
  try {
    const out = execSync(
      `ss -tlnp -H 2>/dev/null | awk '$4=="${hostname}:${port}" || $4=="*:${port}"{print $0}'`,
      { encoding: "utf-8", timeout: 2000 },
    ).trim();
    if (out) {
      const m = out.match(/pid=(\d+)/);
      if (m) opencodePid = Number(m[1]);
    }
  } catch (e) {
    notes.push(
      `ss probe failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (opencodePid === null) {
    try {
      const out = execSync(
        `pgrep -af 'opencode serve.*${hostname}' 2>/dev/null | head -1`,
        { encoding: "utf-8", timeout: 2000 },
      ).trim();
      const m = out.match(/^(\d+)\s/);
      if (m) opencodePid = Number(m[1]);
    } catch {
      // pgrep absence is non-fatal - we just stay null.
    }
  }

  if (opencodePid === null) {
    return {
      scope: "unknown",
      unitName: null,
      opencodePid: null,
      detectionNotes: [...notes, "no opencode process matched host:port"],
    };
  }

  try {
    const cgroup = execSync(`cat /proc/${opencodePid}/cgroup 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 1000,
    }).trim();

    const segments = cgroup.split("/").filter((s) => s.endsWith(".service"));
    const leaf = segments[segments.length - 1] ?? "";
    const leafIsActualUnit = leaf && !leaf.startsWith("user@");
    if (leafIsActualUnit && cgroup.includes("/user.slice/")) {
      return {
        scope: "user",
        unitName: leaf,
        opencodePid,
        detectionNotes: [...notes, `cgroup: ${cgroup}`],
      };
    }
    if (leafIsActualUnit && cgroup.includes("/system.slice/")) {
      return {
        scope: "system",
        unitName: leaf,
        opencodePid,
        detectionNotes: [...notes, `cgroup: ${cgroup}`],
      };
    }

    return {
      scope: "unknown",
      unitName: null,
      opencodePid,
      detectionNotes: [
        ...notes,
        `cgroup does not match any systemd slice: ${cgroup}`,
      ],
    };
  } catch (e) {
    return {
      scope: "unknown",
      unitName: null,
      opencodePid,
      detectionNotes: [
        ...notes,
        `cgroup read failed: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
}

export function restartUserService(unit: string): { ok: boolean; output: string } {
  try {
    const out = execSync(`systemctl --user restart ${shellEscape(unit)}`, {
      encoding: "utf-8",
      timeout: 30000,
      env: withUserBusEnv(),
    });
    return { ok: true, output: out };
  } catch (e) {
    return {
      ok: false,
      output: e instanceof Error ? e.message : String(e),
    };
  }
}

// systemctl --user needs XDG_RUNTIME_DIR + DBUS_SESSION_BUS_ADDRESS to
// reach the user manager's dbus socket. The systemd user manager sets
// these on every service it spawns, but our launcher (runner.sh) used
// to scrub them via `env -i` before exec, leaving the openportal process
// with bus-less child invocations. runner.sh now forwards them, but we
// keep a defensive fallback here so an out-of-band launch (`bun run`
// manually, dev container, etc.) still works.
function withUserBusEnv(): NodeJS.ProcessEnv {
  const uid = process.getuid?.();
  const runtime =
    process.env.XDG_RUNTIME_DIR ?? (uid !== undefined ? `/run/user/${uid}` : undefined);
  const dbus =
    process.env.DBUS_SESSION_BUS_ADDRESS ??
    (runtime !== undefined ? `unix:path=${runtime}/bus` : undefined);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (runtime !== undefined) env.XDG_RUNTIME_DIR = runtime;
  if (dbus !== undefined) env.DBUS_SESSION_BUS_ADDRESS = dbus;
  return env;
}

function shellEscape(s: string): string {
  if (!/^[\w@.+:-]+$/.test(s)) {
    throw new Error(`refusing to shell-escape suspicious unit name: ${s}`);
  }
  return s;
}
