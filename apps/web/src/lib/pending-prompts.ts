// Bulletproof prompt history: localStorage as the FIRST bastion.
//
// The user's invariant (verbatim): "Make it bullet proof. No prompts,
// ever, must be lost. Even if openportal is down, for a brief moment
// or for hours!"
//
// Flow per the user spec:
//   1. Submit handler writes to localStorage IMMEDIATELY, before any
//      fetch. The prompt is now durably captured client-side regardless
//      of what happens to the network/server next.
//   2. Submit handler POSTs to /api/.../prompt. On 202 + archive row
//      ID, calls clearPendingSubmission(localId) - the backend archive
//      is now the durable record.
//   3. On any failure (network error, openportal down, timeout, browser
//      tab restart mid-submit), the localStorage entry persists.
//   4. Prompts history page reads BOTH backend archive AND this
//      localStorage store, merges by submittedAt. Local entries show
//      with a 'not sent' pill.
//   5. (Phase 2, deferred) A render-time reconciler POSTs orphan local
//      entries to a new /api/prompts/persist-orphan endpoint that
//      archives them with status='history-only' so they survive even a
//      localStorage clear.
//
// Storage shape (single key, single JSON array):
//   key:   openportal-pending-prompts-v1
//   value: PendingPromptEntry[]
//
// Cross-tab sync via 'storage' window event. Each entry has a unique
// localId (crypto.randomUUID() or fallback) so concurrent writes don't
// race.

const STORAGE_KEY = "openportal-pending-prompts-v1";

export interface PendingPromptEntry {
  localId: string;
  sessionId: string;
  port: number;
  text: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
  attachmentsCount: number;
  submittedAt: number;
  lastError?: string;
  attempts: number;
  kind: "prompt" | "command";
  commandName?: string;
  commandArguments?: string;
}

type Listener = (entries: PendingPromptEntry[]) => void;
const listeners = new Set<Listener>();

function readAll(): PendingPromptEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingPromptEntry =>
        e &&
        typeof e === "object" &&
        typeof e.localId === "string" &&
        typeof e.sessionId === "string" &&
        typeof e.port === "number" &&
        typeof e.text === "string" &&
        typeof e.submittedAt === "number" &&
        (e.kind === "prompt" || e.kind === "command"),
    );
  } catch {
    return [];
  }
}

function writeAll(entries: PendingPromptEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
  }
  for (const listener of listeners) {
    listener(entries);
  }
}

function makeLocalId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `loc_${crypto.randomUUID()}`;
  }
  return `loc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function recordPendingSubmission(
  input: Omit<PendingPromptEntry, "localId" | "submittedAt" | "attempts"> & {
    submittedAt?: number;
  },
): string {
  const localId = makeLocalId();
  const entry: PendingPromptEntry = {
    localId,
    submittedAt: input.submittedAt ?? Date.now(),
    attempts: 1,
    ...input,
  };
  const all = readAll();
  all.push(entry);
  writeAll(all);
  return localId;
}

export function clearPendingSubmission(localId: string): void {
  const all = readAll();
  const next = all.filter((e) => e.localId !== localId);
  if (next.length === all.length) return;
  writeAll(next);
}

export function recordFailedAttempt(
  localId: string,
  lastError: string,
): void {
  const all = readAll();
  let mutated = false;
  for (const e of all) {
    if (e.localId === localId) {
      e.attempts += 1;
      e.lastError = lastError;
      mutated = true;
      break;
    }
  }
  if (mutated) writeAll(all);
}

export function listPendingSubmissions(
  sessionId?: string,
): PendingPromptEntry[] {
  const all = readAll();
  if (sessionId === undefined) return all;
  return all.filter((e) => e.sessionId === sessionId);
}

export function subscribePendingSubmissions(cb: Listener): () => void {
  listeners.add(cb);
  if (typeof window !== "undefined") {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== STORAGE_KEY) return;
      cb(readAll());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(cb);
}

import { useEffect, useState } from "react";

export function usePendingSubmissions(
  sessionId?: string,
): PendingPromptEntry[] {
  const [entries, setEntries] = useState<PendingPromptEntry[]>(() =>
    listPendingSubmissions(sessionId),
  );
  useEffect(() => {
    setEntries(listPendingSubmissions(sessionId));
    return subscribePendingSubmissions((all) => {
      setEntries(
        sessionId === undefined
          ? all
          : all.filter((e) => e.sessionId === sessionId),
      );
    });
  }, [sessionId]);
  return entries;
}
