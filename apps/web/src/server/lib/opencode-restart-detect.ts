import { execSync } from "node:child_process";

import {
  detectOpencodeService,
  restartUserService,
  type OpencodeServiceInfo,
} from "./opencode-service";

// Restart-detection layered on top of opencode-service.ts. The base
// detector (detectOpencodeService) walks /proc/<pid>/cgroup and only
// works while opencode is ALIVE. We need a fallback that fires when
// opencode is already DOWN - exactly the case where the restart button
// appears - so we add a discovery layer that asks systemd directly:
//
//   systemctl --user list-unit-files --no-legend --no-pager 'opencode-*'
//
// matching units by name pattern instead of process pid. If exactly one
// candidate exists, we return it as the restart target. Multiple
// matches surface the list so the caller (UI) can ask the user.

export interface OpencodeRestartCandidate {
  scope: "user" | "system";
  unitName: string;
  loadState: string;
  activeState?: string;
}

export interface OpencodeRestartDetection {
  primary: OpencodeServiceInfo;
  candidates: OpencodeRestartCandidate[];
  recommended: OpencodeRestartCandidate | null;
  source: "cgroup" | "systemctl-fallback" | "none";
}

const UNIT_NAME_PATTERN = /^[\w@.+:-]+\.service$/;
const ALLOWED_UNIT_PREFIX = /^opencode[-_]/;

function listOpencodeUnits(): OpencodeRestartCandidate[] {
  try {
    const out = execSync(
      "systemctl --user list-unit-files --no-legend --no-pager --type=service 'opencode-*' 2>/dev/null",
      { encoding: "utf-8", timeout: 3000 },
    );
    const candidates: OpencodeRestartCandidate[] = [];
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const unit = parts[0];
      const state = parts[1] ?? "";
      if (!unit || !UNIT_NAME_PATTERN.test(unit)) continue;
      if (!ALLOWED_UNIT_PREFIX.test(unit)) continue;
      candidates.push({
        scope: "user",
        unitName: unit,
        loadState: state,
      });
    }
    return candidates;
  } catch {
    return [];
  }
}

function fetchActiveState(unit: string): string | undefined {
  try {
    const out = execSync(
      `systemctl --user is-active ${unit} 2>/dev/null`,
      { encoding: "utf-8", timeout: 2000 },
    ).trim();
    return out || undefined;
  } catch (e) {
    if (e && typeof e === "object" && "stdout" in e) {
      const stdout = (e as { stdout?: Buffer }).stdout;
      if (stdout) return stdout.toString().trim();
    }
    return undefined;
  }
}

export function detectOpencodeRestart(
  hostname: string,
  port: number,
): OpencodeRestartDetection {
  const primary = detectOpencodeService(hostname, port);
  if (primary.scope === "user" && primary.unitName) {
    return {
      primary,
      candidates: [
        {
          scope: "user",
          unitName: primary.unitName,
          loadState: "enabled",
          activeState: fetchActiveState(primary.unitName),
        },
      ],
      recommended: {
        scope: "user",
        unitName: primary.unitName,
        loadState: "enabled",
        activeState: fetchActiveState(primary.unitName),
      },
      source: "cgroup",
    };
  }
  const candidates = listOpencodeUnits().map((c) => ({
    ...c,
    activeState: fetchActiveState(c.unitName),
  }));
  if (candidates.length === 0) {
    return { primary, candidates: [], recommended: null, source: "none" };
  }
  const activeMatches = candidates.filter(
    (c) => c.activeState === "active" || c.activeState === "activating",
  );
  const recommended =
    activeMatches.length === 1
      ? activeMatches[0]
      : candidates.length === 1
        ? candidates[0]
        : null;
  return {
    primary,
    candidates,
    recommended,
    source: "systemctl-fallback",
  };
}

export function restartOpencodeUnit(unit: string): {
  ok: boolean;
  output: string;
} {
  if (!UNIT_NAME_PATTERN.test(unit) || !ALLOWED_UNIT_PREFIX.test(unit)) {
    return {
      ok: false,
      output: `refusing to restart unit ${JSON.stringify(unit)} - must start with 'opencode-' and end with '.service'`,
    };
  }
  return restartUserService(unit);
}
