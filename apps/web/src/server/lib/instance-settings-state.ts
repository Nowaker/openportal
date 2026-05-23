import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "instance";

export interface InstanceSettings {
  toolOutputMaxBytes: number | null;
  lastSeenStuckDetectorActionId: number;
}

const DEFAULTS: InstanceSettings = {
  toolOutputMaxBytes: null,
  lastSeenStuckDetectorActionId: 0,
};

function readConfig(): InstanceSettings {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const obj = raw as Partial<InstanceSettings>;
  const cap = obj.toolOutputMaxBytes;
  const lastSeen = obj.lastSeenStuckDetectorActionId;
  return {
    toolOutputMaxBytes:
      cap === null || cap === undefined
        ? null
        : typeof cap === "number" && cap > 0 && Number.isFinite(cap)
          ? Math.floor(cap)
          : null,
    lastSeenStuckDetectorActionId:
      typeof lastSeen === "number" && Number.isFinite(lastSeen) && lastSeen >= 0
        ? Math.floor(lastSeen)
        : 0,
  };
}

function writeConfig(config: InstanceSettings): InstanceSettings {
  setSetting(NAMESPACE, config);
  return config;
}

export function getInstanceSettings(): InstanceSettings {
  return readConfig();
}

export function setToolOutputMaxBytes(value: number | null): InstanceSettings {
  const config = readConfig();
  if (value === null || !Number.isFinite(value) || value <= 0) {
    config.toolOutputMaxBytes = null;
  } else {
    config.toolOutputMaxBytes = Math.floor(value);
  }
  return writeConfig(config);
}

export function getToolOutputMaxBytes(): number | null {
  return readConfig().toolOutputMaxBytes;
}

export function getLastSeenStuckDetectorActionId(): number {
  return readConfig().lastSeenStuckDetectorActionId;
}

export function setLastSeenStuckDetectorActionId(value: number): void {
  const config = readConfig();
  config.lastSeenStuckDetectorActionId =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  writeConfig(config);
}
