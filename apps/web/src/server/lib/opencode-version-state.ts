import { execSync } from "child_process";
import { existsSync } from "fs";
import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "opencodeUpdate";

export interface OpencodeUpdateState {
  lastAcknowledgedVersion: string | null;
}

const DEFAULTS: OpencodeUpdateState = {
  lastAcknowledgedVersion: null,
};

function readState(): OpencodeUpdateState {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const obj = raw as Partial<OpencodeUpdateState>;
  return {
    lastAcknowledgedVersion:
      typeof obj.lastAcknowledgedVersion === "string"
        ? obj.lastAcknowledgedVersion
        : null,
  };
}

function writeState(state: OpencodeUpdateState): OpencodeUpdateState {
  setSetting(NAMESPACE, state);
  return state;
}

let versionCache: { value: string | null; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function resolveBinaryPath(): string | null {
  try {
    const out = execSync("command -v opencode 2>/dev/null", {
      encoding: "utf8",
      timeout: 1500,
    }).trim();
    if (out && existsSync(out)) return out;
  } catch {
    /* fall through */
  }
  const fallbacks = [
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
    "/bin/opencode",
    "/opt/homebrew/bin/opencode",
    `${process.env.HOME ?? ""}/.local/bin/opencode`,
  ];
  for (const candidate of fallbacks) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export function getInstalledOpencodeVersion(force = false): string | null {
  const now = Date.now();
  if (!force && versionCache && now - versionCache.at < CACHE_TTL_MS) {
    return versionCache.value;
  }
  const bin = resolveBinaryPath();
  if (!bin) {
    versionCache = { value: null, at: now };
    return null;
  }
  try {
    const raw = execSync(`${bin} --version 2>/dev/null`, {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const m = raw.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
    const value = m ? m[1] : raw || null;
    versionCache = { value, at: now };
    return value;
  } catch {
    versionCache = { value: null, at: now };
    return null;
  }
}

export interface OpencodeVersionInfo {
  installed: string | null;
  lastAcknowledgedVersion: string | null;
  updated: boolean;
}

export function getOpencodeVersionInfo(force = false): OpencodeVersionInfo {
  const installed = getInstalledOpencodeVersion(force);
  let state = readState();
  if (state.lastAcknowledgedVersion === null && installed !== null) {
    state = writeState({ lastAcknowledgedVersion: installed });
  }
  const updated =
    installed !== null &&
    state.lastAcknowledgedVersion !== null &&
    state.lastAcknowledgedVersion !== installed;
  return {
    installed,
    lastAcknowledgedVersion: state.lastAcknowledgedVersion,
    updated,
  };
}

export function acknowledgeOpencodeVersion(version: string | null): OpencodeVersionInfo {
  const resolved =
    typeof version === "string" && version.length > 0
      ? version
      : getInstalledOpencodeVersion(true);
  writeState({ lastAcknowledgedVersion: resolved });
  return getOpencodeVersionInfo(false);
}
