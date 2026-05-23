import useSWR, { mutate as globalMutate } from "swr";

const KEY = "/api/stuck-detector/config";

export type StuckCause =
  | "stale-stream"
  | "stale-compaction"
  | "question-with-queue"
  | "no-dispatch"
  | "no-runner"
  | "compaction-overflow"
  | "retry-overdue";

export const ALL_STUCK_CAUSES: readonly StuckCause[] = [
  "stale-stream",
  "stale-compaction",
  "question-with-queue",
  "no-dispatch",
  "no-runner",
  "compaction-overflow",
  "retry-overdue",
];

export type CauseAction = "nothing" | "log" | "unstuck" | "bump-overdue";

export const ACTIONS_BY_CAUSE: Record<StuckCause, readonly CauseAction[]> = {
  "stale-stream": ["nothing", "log", "unstuck"],
  "stale-compaction": ["nothing", "log", "unstuck"],
  "question-with-queue": ["nothing", "log"],
  "no-dispatch": ["nothing", "log", "unstuck"],
  "no-runner": ["nothing", "log", "unstuck"],
  "compaction-overflow": ["nothing", "log"],
  "retry-overdue": ["nothing", "log", "bump-overdue"],
};

export const CAUSE_LABELS: Record<StuckCause, string> = {
  "stale-stream": "Generation stream stalled",
  "stale-compaction": "Compaction stream stalled",
  "question-with-queue": "Question is blocking the queue",
  "no-dispatch": "Prompt accepted but never dispatched",
  "no-runner": "Generation runner died",
  "compaction-overflow": "Compaction overflowed context",
  "retry-overdue": "Provider retry wedged",
};

export const ACTION_LABELS: Record<CauseAction, string> = {
  "nothing": "Do nothing (silent)",
  "log": "Log only (no action)",
  "unstuck": "Auto-unstuck (abort+resume)",
  "bump-overdue": "Bump the overdue retry",
};

export interface PerCauseConfig {
  action: CauseAction;
  min_idle_seconds: number;
  cooloff_seconds: number;
}

export interface StuckDetectorConfig {
  stuck_actions: Partial<Record<StuckCause, PerCauseConfig>>;
  [key: string]: unknown;
}

export interface ConfigResponse {
  ok: boolean;
  config?: StuckDetectorConfig;
  error?: string;
  status?: number;
}

async function fetcher(url: string): Promise<ConfigResponse> {
  const r = await fetch(url);
  return (await r.json()) as ConfigResponse;
}

export function useStuckDetectorConfig() {
  return useSWR<ConfigResponse>(KEY, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5_000,
    keepPreviousData: true,
  });
}

export async function updateStuckDetectorConfig(
  next: StuckDetectorConfig,
): Promise<ConfigResponse> {
  const r = await fetch(KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  const body = (await r.json()) as ConfigResponse;
  if (body.ok) {
    await globalMutate(KEY, body, { revalidate: false });
  }
  return body;
}
