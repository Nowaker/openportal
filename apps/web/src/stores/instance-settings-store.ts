import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/instance-settings";

export type NotificationKind =
  | "session-done"
  | "question"
  | "permission-ask"
  | "api-error"
  | "stuck-detected";

export const ALL_NOTIFY_KINDS: readonly NotificationKind[] = [
  "session-done",
  "question",
  "permission-ask",
  "api-error",
  "stuck-detected",
];

export const NOTIFY_KIND_LABELS: Record<NotificationKind, string> = {
  "session-done": "Session completed",
  "question": "Question (model needs answer)",
  "permission-ask": "Permission ask",
  "api-error": "API error",
  "stuck-detected": "Stuck verdict",
};

export interface NotifyRule {
  notify: boolean;
  notifyEvenIfActiveTab: boolean;
}

export type NotifyPolicy = Record<NotificationKind, NotifyRule>;

export interface InstanceSettings {
  toolOutputMaxBytes: number | null;
  notifyPolicy: NotifyPolicy;
}

const DEFAULT_NOTIFY_POLICY: NotifyPolicy = {
  "session-done": { notify: true, notifyEvenIfActiveTab: false },
  "question": { notify: true, notifyEvenIfActiveTab: true },
  "permission-ask": { notify: true, notifyEvenIfActiveTab: true },
  "api-error": { notify: true, notifyEvenIfActiveTab: true },
  "stuck-detected": { notify: true, notifyEvenIfActiveTab: false },
};

export const EMPTY_INSTANCE_SETTINGS: InstanceSettings = {
  toolOutputMaxBytes: null,
  notifyPolicy: { ...DEFAULT_NOTIFY_POLICY },
};

function coerceNotifyPolicy(raw: unknown): NotifyPolicy {
  const out: NotifyPolicy = { ...DEFAULT_NOTIFY_POLICY };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const kind of ALL_NOTIFY_KINDS) {
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

async function fetcher(url: string): Promise<InstanceSettings> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`instance-settings fetch failed: ${r.status}`);
  const raw = (await r.json()) as Partial<InstanceSettings>;
  const cap = raw.toolOutputMaxBytes;
  return {
    toolOutputMaxBytes:
      typeof cap === "number" && cap > 0 && Number.isFinite(cap)
        ? Math.floor(cap)
        : null,
    notifyPolicy: coerceNotifyPolicy(raw.notifyPolicy),
  };
}

export function useInstanceSettings(): {
  settings: InstanceSettings;
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, isLoading, error } = useSWR<InstanceSettings>(KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    keepPreviousData: true,
  });
  return {
    settings: data ?? EMPTY_INSTANCE_SETTINGS,
    isLoading: isLoading && !data,
    error: error as Error | undefined,
  };
}

export async function setToolOutputMaxBytes(
  value: number | null,
): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolOutputMaxBytes: value }),
  });
  if (!r.ok) throw new Error(`setToolOutputMaxBytes failed: ${r.status}`);
  const next = (await r.json()) as InstanceSettings;
  await globalMutate(KEY, next, { revalidate: false });
}

export async function setNotifyRule(
  notifyKind: NotificationKind,
  rule: NotifyRule,
): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notifyKind,
      notify: rule.notify,
      notifyEvenIfActiveTab: rule.notifyEvenIfActiveTab,
    }),
  });
  if (!r.ok) throw new Error(`setNotifyRule failed: ${r.status}`);
  const next = (await r.json()) as InstanceSettings;
  await globalMutate(KEY, next, { revalidate: false });
}

export async function resetNotifyPolicy(): Promise<void> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resetNotifyPolicy: true }),
  });
  if (!r.ok) throw new Error(`resetNotifyPolicy failed: ${r.status}`);
  const next = (await r.json()) as InstanceSettings;
  await globalMutate(KEY, next, { revalidate: false });
}
