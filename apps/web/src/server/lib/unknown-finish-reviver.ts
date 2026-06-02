export interface MessageInfoLike {
  id?: string;
  role?: string;
  finish?: string | null;
  time?: { completed?: number | string | null };
}

export interface MessageLike {
  info?: MessageInfoLike;
  parts?: unknown[];
}

export interface UnknownFinishDetection {
  shouldRevive: boolean;
  reason: string;
  signature?: string;
}

export const UNKNOWN_FINISH_REVIVE_PROMPT =
  "[ openportal: unknown error: Continue working diligently to fulfill all user's tasks. ]";

const MIN_TEXT_LEN_TO_ASSUME_REAL_COMPLETION = 24;

function normalizeNumber(v: number | string | null | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Date.parse(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function assistantTextLen(parts: unknown[] | undefined): number {
  if (!Array.isArray(parts)) return 0;
  let out = 0;
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as {
      type?: unknown;
      text?: unknown;
      state?: { output?: unknown };
    };
    if (part.type === "text" && typeof part.text === "string") {
      out += part.text.trim().length;
      continue;
    }
    if (part.type === "tool") {
      const output = part.state?.output;
      if (typeof output === "string") out += output.trim().length;
      else if (output && typeof output === "object") out += 64;
    }
  }
  return out;
}

export function detectUnknownFinishTerminalFailure(
  messages: unknown[],
): UnknownFinishDetection {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { shouldRevive: false, reason: "no-messages" };
  }
  const last = messages[messages.length - 1] as MessageLike;
  const info = last?.info;
  if (!info || info.role !== "assistant") {
    return { shouldRevive: false, reason: "last-not-assistant" };
  }
  if (info.finish !== "unknown") {
    return { shouldRevive: false, reason: "finish-not-unknown" };
  }

  const completed = normalizeNumber(info.time?.completed);
  if (completed === null) {
    return { shouldRevive: false, reason: "assistant-not-terminal" };
  }

  const textLen = assistantTextLen(last.parts);
  if (textLen >= MIN_TEXT_LEN_TO_ASSUME_REAL_COMPLETION) {
    return { shouldRevive: false, reason: "assistant-has-substantial-content" };
  }

  const messageId = typeof info.id === "string" ? info.id : "no-id";
  return {
    shouldRevive: true,
    reason: textLen > 0 ? "unknown-finish-thin-content" : "unknown-finish-empty",
    signature: `${messageId}:${completed}:unknown:${textLen}`,
  };
}

interface AttemptEntry {
  signature: string;
  attempts: number;
  lastAttemptAt: number;
}

export class UnknownFinishReviveGuard {
  private readonly attempts = new Map<string, AttemptEntry>();

  constructor(
    private readonly maxAttemptsPerSignature = 3,
    private readonly maxBackoffMs = 5 * 60 * 1000,
  ) {}

  private requiredBackoffMs(attempts: number): number {
    const raw = 5_000 * 2 ** Math.max(0, attempts - 1);
    return Math.min(this.maxBackoffMs, raw);
  }

  shouldAttempt(sessionKey: string, signature: string, now = Date.now()): boolean {
    const cur = this.attempts.get(sessionKey);
    if (!cur) return true;
    if (cur.signature !== signature) return true;
    if (cur.attempts >= this.maxAttemptsPerSignature) return false;
    const wait = this.requiredBackoffMs(cur.attempts);
    return now - cur.lastAttemptAt >= wait;
  }

  recordAttempt(sessionKey: string, signature: string, now = Date.now()): void {
    const cur = this.attempts.get(sessionKey);
    if (!cur || cur.signature !== signature) {
      this.attempts.set(sessionKey, { signature, attempts: 1, lastAttemptAt: now });
      return;
    }
    this.attempts.set(sessionKey, {
      signature,
      attempts: cur.attempts + 1,
      lastAttemptAt: now,
    });
  }

  resetSession(sessionKey: string): void {
    this.attempts.delete(sessionKey);
  }
}
