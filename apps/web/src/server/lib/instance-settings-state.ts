import { getSettings, setSetting } from "./portal-state";

const NAMESPACE = "instance";

export type NotificationKind =
  | "session-done"
  | "question"
  | "permission-ask"
  | "api-error"
  | "stuck-detected";

export interface NotifyRule {
  notify: boolean;
  notifyEvenIfActiveTab: boolean;
}

export type NotifyPolicy = Record<NotificationKind, NotifyRule>;

const NOTIFY_KINDS: readonly NotificationKind[] = [
  "session-done",
  "question",
  "permission-ask",
  "api-error",
  "stuck-detected",
];

const DEFAULT_NOTIFY_POLICY: NotifyPolicy = {
  "session-done": { notify: true, notifyEvenIfActiveTab: false },
  "question": { notify: true, notifyEvenIfActiveTab: true },
  "permission-ask": { notify: true, notifyEvenIfActiveTab: true },
  "api-error": { notify: true, notifyEvenIfActiveTab: true },
  "stuck-detected": { notify: true, notifyEvenIfActiveTab: false },
};

export interface InstanceSettings {
  toolOutputMaxBytes: number | null;
  lastSeenStuckDetectorActionId: number;
  notifyPolicy: NotifyPolicy;
}

const DEFAULTS: InstanceSettings = {
  toolOutputMaxBytes: null,
  lastSeenStuckDetectorActionId: 0,
  notifyPolicy: { ...DEFAULT_NOTIFY_POLICY },
};

export function defaultNotifyPolicy(): NotifyPolicy {
  return {
    "session-done": { ...DEFAULT_NOTIFY_POLICY["session-done"] },
    "question": { ...DEFAULT_NOTIFY_POLICY.question },
    "permission-ask": { ...DEFAULT_NOTIFY_POLICY["permission-ask"] },
    "api-error": { ...DEFAULT_NOTIFY_POLICY["api-error"] },
    "stuck-detected": { ...DEFAULT_NOTIFY_POLICY["stuck-detected"] },
  };
}

function validateNotifyPolicy(raw: unknown): NotifyPolicy {
  const out = defaultNotifyPolicy();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const kind of NOTIFY_KINDS) {
    const entry = r[kind];
    if (!entry || typeof entry !== "object") continue;
    const rule = entry as Partial<NotifyRule>;
    out[kind] = {
      notify: typeof rule.notify === "boolean" ? rule.notify : out[kind].notify,
      notifyEvenIfActiveTab:
        typeof rule.notifyEvenIfActiveTab === "boolean"
          ? rule.notifyEvenIfActiveTab
          : out[kind].notifyEvenIfActiveTab,
    };
  }
  return out;
}

function readConfig(): InstanceSettings {
  const raw = getSettings()[NAMESPACE];
  if (!raw || typeof raw !== "object") return { ...DEFAULTS, notifyPolicy: defaultNotifyPolicy() };
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
    notifyPolicy: validateNotifyPolicy(obj.notifyPolicy),
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

export function getNotifyPolicy(): NotifyPolicy {
  return readConfig().notifyPolicy;
}

export function setNotifyRule(kind: NotificationKind, rule: NotifyRule): InstanceSettings {
  const config = readConfig();
  config.notifyPolicy = {
    ...config.notifyPolicy,
    [kind]: {
      notify: typeof rule.notify === "boolean" ? rule.notify : true,
      notifyEvenIfActiveTab:
        typeof rule.notifyEvenIfActiveTab === "boolean"
          ? rule.notifyEvenIfActiveTab
          : false,
    },
  };
  return writeConfig(config);
}

export function resetNotifyPolicy(): InstanceSettings {
  const config = readConfig();
  config.notifyPolicy = defaultNotifyPolicy();
  return writeConfig(config);
}
