export interface PermissionDecision {
  requestId: string;
  sessionId: string;
  messageId: string | undefined;
  callId: string | undefined;
  decision: "once" | "always" | "reject";
  decidedAt: number;
  patterns: string[];
  permissionType: string;
  toolName: string | undefined;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  decision: PermissionDecision;
  expires: number;
}

const byRequest = new Map<string, CacheEntry>();
const byMessage = new Map<string, Set<string>>();

function key(port: number, sessionId: string, requestId: string): string {
  return `${port}|${sessionId}|${requestId}`;
}

function messageKey(port: number, sessionId: string, messageId: string): string {
  return `${port}|${sessionId}|${messageId}`;
}

export function recordPermissionDecision(
  port: number,
  decision: PermissionDecision,
): void {
  const k = key(port, decision.sessionId, decision.requestId);
  byRequest.set(k, { decision, expires: Date.now() + TTL_MS });
  if (decision.messageId) {
    const mk = messageKey(port, decision.sessionId, decision.messageId);
    let set = byMessage.get(mk);
    if (!set) {
      set = new Set();
      byMessage.set(mk, set);
    }
    set.add(k);
  }
}

export function getDecisionsForMessage(
  port: number,
  sessionId: string,
  messageId: string,
): PermissionDecision[] {
  const mk = messageKey(port, sessionId, messageId);
  const set = byMessage.get(mk);
  if (!set) return [];
  const now = Date.now();
  const out: PermissionDecision[] = [];
  for (const k of set) {
    const e = byRequest.get(k);
    if (!e) {
      set.delete(k);
      continue;
    }
    if (e.expires < now) {
      byRequest.delete(k);
      set.delete(k);
      continue;
    }
    out.push(e.decision);
  }
  return out.sort((a, b) => a.decidedAt - b.decidedAt);
}
