import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "instance";

export interface InstanceSettings {
  toolOutputMaxBytes: number | null;
}

const DEFAULTS: InstanceSettings = {
  toolOutputMaxBytes: null,
};

function readConfig(): InstanceSettings {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const obj = raw as Partial<InstanceSettings>;
  const cap = obj.toolOutputMaxBytes;
  return {
    toolOutputMaxBytes:
      cap === null || cap === undefined
        ? null
        : typeof cap === "number" && cap > 0 && Number.isFinite(cap)
          ? Math.floor(cap)
          : null,
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
