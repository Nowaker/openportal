import { defineHandler, getQuery } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import { stashDataUrl, hasCachedThumb } from "../../../../lib/blob-cache";

const DEFAULT_INITIAL_LIMIT = 50;
const MAX_LIMIT = 1000;

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const query = getQuery(event);

  const limit = parseLimit(query.limit);

  const client = getOpencodeClient(port);
  const messages = await client.session.messages({
    path: { id },
    query: limit !== undefined ? { limit } : undefined,
  });

  const stripped = stripDiagnosticFixes(messages.data);
  stripUserMessageSummary(stripped);
  rewriteImageDataUrls(stripped, id);
  return stripped;
});

// opencode rebuilds message.info.summary on every user message, summarising
// the working-tree changes since the previous user prompt: a list of files
// with status + counts AND the full unified-diff `patch` text per file.
// The patch text dominates (99pct of each diff entry) and the same big
// patches re-attach to every subsequent user message until the tree is
// committed - 380+ user messages in this DB carry summary.diffs adding up
// to ~310 MB of inline patch noise. The model never reads message.summary
// (it consumes parts only) and the Portal frontend has zero references to
// .summary anywhere - confirmed by grep across apps/web/src. Drop it.
function stripUserMessageSummary(messages: unknown): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as { info?: { summary?: unknown }; data?: { summary?: unknown } };
    if (m.info && "summary" in m.info) delete m.info.summary;
    if (m.data && "summary" in m.data) delete m.data.summary;
  }
}

function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_INITIAL_LIMIT;
  }
  if (raw === "all" || raw === "0") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_INITIAL_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// opencode's write/edit tools snapshot the full workspace LSP diagnostics
// map onto state.metadata.diagnostics of every resulting tool part. With
// rich-LSP servers like kotlin-ls, a single Kotlin/Android session
// accumulates tens of thousands of diagnostic objects (the same ~hundred
// errors snapshotted into every one of hundreds of tool parts), each
// carrying psi parser state, code-action fixes with full-file oldText/
// newText blobs, etc. The Portal frontend never reads
// state.metadata.diagnostics anywhere - confirmed by grep. The model
// already consumed those diagnostics at tool-call time; re-shipping them
// to the browser on every messages?limit=N fetch is pure overhead. Strip
// the entire `diagnostics` field from every part before returning. Both
// shapes seen in the wild: part.state.metadata.diagnostics (newer
// opencode) and part.data.state.metadata.diagnostics (older).
function stripDiagnosticFixes(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      stripPartDiagnostics(part);
    }
  }
  return messages;
}

interface MetadataLike {
  metadata?: { diagnostics?: unknown };
}

function stripPartDiagnostics(part: unknown): void {
  if (!part || typeof part !== "object") return;
  const candidates: Array<MetadataLike | undefined> = [
    (part as { state?: MetadataLike }).state,
    ((part as { data?: { state?: MetadataLike } }).data ?? {}).state,
  ];
  for (const c of candidates) {
    if (c?.metadata && "diagnostics" in c.metadata) {
      delete c.metadata.diagnostics;
    }
  }
}

// Rewrite `file` parts whose `url` is an inline `data:image/...;base64,...`
// string: stash the bytes under ~/.cache/openportal/blobs/<sessionId>/ and
// replace the url with /api/blob/<sessionId>/<hash>.<ext>. Idempotent on
// already-rewritten parts (skips anything that doesn't start with "data:").
// opencode's DB still has the inline base64 - this is purely a
// wire-format optimization for the Portal client. The browser will fetch
// the blob lazily through the rewritten URL and cache it (immutable
// cache-control on the serving endpoint).
function rewriteImageDataUrls(messages: unknown, sessionId: string): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as {
        type?: string;
        url?: string;
        mime?: string;
        thumb?: string;
      };
      if (p.type !== "file") continue;
      if (typeof p.url !== "string") continue;
      if (p.url.startsWith("data:")) {
        const stashed = stashDataUrl(sessionId, p.url, p.mime);
        if (!stashed) continue;
        p.url = `/api/blob/${sessionId}/${stashed.hash}.${stashed.ext}`;
        if (stashed.hasThumb) {
          p.thumb = `/api/blob/${sessionId}/${stashed.hash}.thumb.webp`;
        }
        continue;
      }
      const m = /^\/api\/blob\/[^/]+\/([0-9a-f]{16})\.[a-z0-9]+$/i.exec(p.url);
      if (m && hasCachedThumb(sessionId, m[1])) {
        p.thumb = `/api/blob/${sessionId}/${m[1]}.thumb.webp`;
      }
    }
  }
}
