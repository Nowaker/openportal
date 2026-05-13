interface CacheEntry {
  text: string;
  expires: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function k(sessionId: string, messageId: string, blockId: string): string {
  return `${sessionId}|${messageId}|${blockId}`;
}

export function putOmoBody(
  sessionId: string,
  messageId: string,
  blockId: string,
  text: string,
): void {
  cache.set(k(sessionId, messageId, blockId), {
    text,
    expires: Date.now() + TTL_MS,
  });
}

export function getOmoBody(
  sessionId: string,
  messageId: string,
  blockId: string,
): string | null {
  const key = k(sessionId, messageId, blockId);
  const e = cache.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return e.text;
}

export function purgeMessageOmo(sessionId: string, messageId: string): void {
  const prefix = `${sessionId}|${messageId}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
