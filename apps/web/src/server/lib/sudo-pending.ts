// Security model: the password never lives in this map. The deferred
// resolves with the resolution object and the value is consumed by
// the spawn caller immediately. We only carry command + reason +
// timestamps + the deferred handles. The :request_id <-> command
// binding is enforced server-side: the browser only ever sees
// request_id, never the command-to-be-run association table. 5-min
// hard timeout, explicit deny short-circuits the wait.

import { randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export type PendingResolution =
  | { kind: "password"; password: string }
  | { kind: "deny"; reason?: string };

interface PendingEntry {
  request_id: string;
  command: string;
  reason: string;
  created_at: number;
  resolve: (value: PendingResolution) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingSudoView {
  request_id: string;
  command: string;
  reason: string;
  created_at: number;
  age_ms: number;
}

const pending = new Map<string, PendingEntry>();

export function registerPendingSudo(
  command: string,
  reason: string,
): { request_id: string; wait: Promise<PendingResolution> } {
  const request_id = randomUUID();
  const created_at = Date.now();

  let resolve!: (value: PendingResolution) => void;
  let reject!: (err: Error) => void;
  const wait = new Promise<PendingResolution>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timer = setTimeout(() => {
    if (pending.delete(request_id)) {
      reject(new Error("sudo prompt timed out"));
    }
  }, REQUEST_TIMEOUT_MS);

  pending.set(request_id, {
    request_id,
    command,
    reason,
    created_at,
    resolve,
    reject,
    timer,
  });

  return { request_id, wait };
}

export function answerPendingSudo(
  request_id: string,
  resolution: PendingResolution,
): boolean {
  const entry = pending.get(request_id);
  if (!entry) return false;
  pending.delete(request_id);
  clearTimeout(entry.timer);
  entry.resolve(resolution);
  return true;
}

export function listPendingSudo(): PendingSudoView[] {
  const now = Date.now();
  return Array.from(pending.values()).map((entry) => ({
    request_id: entry.request_id,
    command: entry.command,
    reason: entry.reason,
    created_at: entry.created_at,
    age_ms: now - entry.created_at,
  }));
}
