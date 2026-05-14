// Auto-approve configuration. Stored in ~/.openportal-state.json under
// the `settings.autoApprove` namespace via the existing portal-state
// helpers. Two surfaces persist here:
//
//   - globalDefault: applied to every session that has no override.
//   - sessionOverrides: per-session overrides keyed by opencode session
//     id. Presence in the map (regardless of value) wins over the
//     global default.
//
// Effective resolution: override-if-present, else globalDefault, else
// false. The auto-approve worker plugin reads the effective value when
// a permission.asked event arrives; the settings UI mutates this map
// directly.

import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "autoApprove";

export interface AutoApproveConfig {
  globalDefault: boolean;
  sessionOverrides: Record<string, boolean>;
}

function emptyConfig(): AutoApproveConfig {
  return { globalDefault: false, sessionOverrides: {} };
}

function readConfig(): AutoApproveConfig {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return emptyConfig();
  const obj = raw as Partial<AutoApproveConfig>;
  const globalDefault =
    typeof obj.globalDefault === "boolean" ? obj.globalDefault : false;
  const overrides: Record<string, boolean> = {};
  if (obj.sessionOverrides && typeof obj.sessionOverrides === "object") {
    for (const [k, v] of Object.entries(obj.sessionOverrides)) {
      if (typeof v === "boolean" && typeof k === "string" && k.length > 0) {
        overrides[k] = v;
      }
    }
  }
  return { globalDefault, sessionOverrides: overrides };
}

function writeConfig(config: AutoApproveConfig): AutoApproveConfig {
  setSetting(NAMESPACE, config);
  return config;
}

export function getAutoApproveConfig(): AutoApproveConfig {
  return readConfig();
}

export function setAutoApproveDefault(value: boolean): AutoApproveConfig {
  const config = readConfig();
  config.globalDefault = value;
  return writeConfig(config);
}

export function setSessionOverride(
  sessionId: string,
  value: boolean,
): AutoApproveConfig {
  const config = readConfig();
  config.sessionOverrides[sessionId] = value;
  return writeConfig(config);
}

export function removeSessionOverride(sessionId: string): AutoApproveConfig {
  const config = readConfig();
  delete config.sessionOverrides[sessionId];
  return writeConfig(config);
}

export function clearAllOverrides(): AutoApproveConfig {
  const config = readConfig();
  config.sessionOverrides = {};
  return writeConfig(config);
}

export function getEffectiveAutoApprove(sessionId: string): boolean {
  const config = readConfig();
  if (sessionId in config.sessionOverrides) {
    return config.sessionOverrides[sessionId];
  }
  return config.globalDefault;
}
