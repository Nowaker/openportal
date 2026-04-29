import { defineHandler, getQuery } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

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

  return stripDiagnosticFixes(messages.data);
});

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
