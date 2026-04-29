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

// opencode's write/edit tools persist whole-workspace LSP diagnostics into
// state.metadata.diagnostics on the resulting tool part. kotlin-ls (and any
// LSP that returns rich code-action data) stuffs full-file oldText/newText
// blobs into each diagnostic.data.fixes[*].modCommandData - 20-50 KB per
// fix, two fixes per diagnostic, dozens of diagnostics per project = MB
// per tool part, multiplied across every tool call in a session. The model
// only ever consults the textual error (severity/message/range); fixes are
// dead weight on the wire. Strip them before returning to the Portal
// client. Both shapes seen in the wild: part.state.metadata.diagnostics
// (newer opencode), part.data.state.metadata.diagnostics (older).
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

interface DiagnosticLike {
  data?: { fixes?: unknown };
}

interface MetadataLike {
  metadata?: { diagnostics?: Record<string, DiagnosticLike[]> };
}

function stripPartDiagnostics(part: unknown): void {
  if (!part || typeof part !== "object") return;
  const candidates: Array<MetadataLike | undefined> = [
    (part as { state?: MetadataLike }).state,
    ((part as { data?: { state?: MetadataLike } }).data ?? {}).state,
  ];
  for (const c of candidates) {
    const diags = c?.metadata?.diagnostics;
    if (!diags || typeof diags !== "object") continue;
    for (const file of Object.keys(diags)) {
      const arr = diags[file];
      if (!Array.isArray(arr)) continue;
      for (const d of arr) {
        if (d?.data && typeof d.data === "object" && "fixes" in d.data) {
          delete d.data.fixes;
        }
      }
    }
  }
}
