import { defineHandler, getQuery, setResponseHeader } from "nitro/h3";
import { getOpencodeClient } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import { stashDataUrl, hasCachedThumb } from "../../../../lib/blob-cache";
import {
  getCachedMessages,
  setCachedMessages,
  messagesAfter,
} from "../../../../lib/messages-cache";
import { parseOmoBlocks } from "../../../../../lib/omo-injection";
import { putOmoBody } from "../../../../lib/omo-strip-cache";
import { getDecisionsForMessage } from "../../../../lib/permission-audit";
import { getToolOutputMaxBytes } from "../../../../lib/instance-settings-state";

const DEFAULT_INITIAL_LIMIT = 50;
const MAX_LIMIT = 1000;

// Cache + since-aware messages handler. Modes:
//
//   ?id=<msgId>           - single-element array containing just that
//                           message; empty array if not found. Sets the
//                           X-Target-Found / X-Target-Index /
//                           X-Messages-Total response headers so the
//                           permalink loader knows where it sits.
//   ?before=<msgId>&limit - up to `limit` messages strictly BEFORE
//                           msgId (chronological order). Same target
//                           headers.
//   ?after=<msgId>&limit  - up to `limit` messages strictly AFTER
//                           msgId (chronological order). Same target
//                           headers.
//   ?since=<msgId>        - all messages strictly newer than msgId
//                           (incremental polling). If msgId not in
//                           cached list, force a fresh full fetch and
//                           try again; if still not found, treat as
//                           stale-since and return everything (client
//                           should reconcile).
//   ?limit=N              - return last N messages, default 50,
//                           "all"/"0" means no limit
//   no params             - same as ?limit=50
//
// The ?id / ?before / ?after triplet underpins permalink-mode loading
// in the route ($id.tsx): client fires four parallel fetches (target,
// 10 before, 10 after, latest 10) so the requested message renders
// first with spinners above/below until the surrounding windows land.
// Cache hit: serve from memory (TTL 2s). Miss: fetch full list from
// opencode (no limit), strip + cache, then slice for the request shape.
// Storing the full list under one cache key lets every variant share
// the same memory entry, so all four permalink fetches typically cost
// one upstream round-trip.
export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const query = getQuery(event);

  const limit = parseLimit(query.limit);
  const since =
    typeof query.since === "string" && query.since.length > 0
      ? query.since
      : null;
  const targetId =
    typeof query.id === "string" && query.id.length > 0 ? query.id : null;
  const beforeId =
    typeof query.before === "string" && query.before.length > 0
      ? query.before
      : null;
  const afterId =
    typeof query.after === "string" && query.after.length > 0
      ? query.after
      : null;

  let full = getCachedMessages(id);
  if (full === null) {
    full = await fetchAndCache(port, id);
  }

  // Permalink-mode lookups all hinge on the index of a specific msgId.
  // When the cached list misses (e.g. cache went stale while the user
  // sat on a permalink in another tab), we force a refresh so the
  // permalink page never lies about "not found" purely because of TTL.
  const permalinkAnchor = targetId ?? beforeId ?? afterId;
  if (permalinkAnchor !== null) {
    let idx = indexOfMessageId(full, permalinkAnchor);
    if (idx < 0) {
      full = await fetchAndCache(port, id);
      idx = indexOfMessageId(full, permalinkAnchor);
    }
    setResponseHeader(event, "X-Messages-Total", String(full.length));
    setResponseHeader(event, "X-Target-Found", idx >= 0 ? "true" : "false");
    if (idx >= 0) {
      setResponseHeader(event, "X-Target-Index", String(idx));
    }
    if (targetId !== null) {
      return idx >= 0 ? [full[idx]] : [];
    }
    if (beforeId !== null) {
      if (idx < 0) return [];
      const n = parsePositiveLimit(query.limit, 10);
      const start = Math.max(0, idx - n);
      return full.slice(start, idx);
    }
    if (afterId !== null) {
      if (idx < 0) return [];
      const n = parsePositiveLimit(query.limit, 10);
      const end = Math.min(full.length, idx + 1 + n);
      return full.slice(idx + 1, end);
    }
  }

  if (since) {
    let after = messagesAfter(full, since);
    if (after === null) {
      full = await fetchAndCache(port, id);
      after = messagesAfter(full, since);
    }
    return after ?? full;
  }

  if (limit === undefined) return full;
  return full.slice(-limit);
});

function indexOfMessageId(messages: unknown[], msgId: string): number {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as { info?: { id?: string } } | undefined;
    if (m?.info?.id === msgId) return i;
  }
  return -1;
}

function parsePositiveLimit(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (raw === "all" || raw === "0") return MAX_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

async function fetchAndCache(port: number, id: string): Promise<unknown[]> {
  const client = await getOpencodeClient(port);
  const messages = await client.session.messages({
    path: { id },
  });

  const stripped = stripDiagnosticFixes(messages.data);
  stripUserMessageSummary(stripped);
  stripPartBloat(stripped);
  stripOmoFromUserText(stripped, id);
  attachPermissionDecisions(stripped, port, id);
  rewriteImageDataUrls(stripped, id);
  const arr = Array.isArray(stripped) ? stripped : [];
  setCachedMessages(id, arr);
  return arr;
}

function attachPermissionDecisions(
  messages: unknown,
  port: number,
  sessionId: string,
): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as { info?: { id?: string } };
    const messageId = m.info?.id;
    if (!messageId) continue;
    const decisions = getDecisionsForMessage(port, sessionId, messageId);
    if (decisions.length === 0) continue;
    (m.info as { _permissionDecisions?: unknown })._permissionDecisions = decisions;
  }
}

// Replace OMO injection bodies inside user-text parts with compact
// reference markers. The full content gets stashed in an in-memory
// cache keyed by (sessionId, messageId, blockId) so the chat can
// lazily fetch it on expand. Wire savings: typical OMO blocks are
// 1-3 KB of directive text; a session with 20 collapsed wrappers
// drops 20-60 KB per messages fetch.
//
// Marker shape: <!--OMO-STRIPPED:<encoded-json>-->
// The encoded JSON carries id (blockId), header (display label),
// summary (subtitle), bytes (size hint for the placeholder UI). The
// client-side parser recognises the marker and renders OmoBlockView
// in lazy mode.
function stripOmoFromUserText(messages: unknown, sessionId: string): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as {
      info?: { id?: string; role?: string };
      parts?: unknown;
    };
    if (m.info?.role !== "user") continue;
    const messageId = m.info?.id;
    if (!messageId) continue;
    const parts = m.parts;
    if (!Array.isArray(parts)) continue;
    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
      const part = parts[pIdx] as { type?: string; text?: unknown };
      if (part?.type !== "text" || typeof part.text !== "string") continue;
      const original = part.text;
      const blocks = parseOmoBlocks(original);
      if (!blocks.some((b) => b.kind === "omo")) continue;
      let blockIdx = 0;
      const out: string[] = [];
      for (const b of blocks) {
        if (b.kind === "user") {
          out.push(b.text);
          continue;
        }
        const blockId = `${pIdx}.${blockIdx++}`;
        putOmoBody(sessionId, messageId, blockId, b.text);
        const meta = JSON.stringify({
          id: blockId,
          header: b.header ?? "",
          summary: b.summary ?? "",
          bytes: b.text.length,
          segments: b.segments,
        });
        out.push(`<!--OMO-STRIPPED:${encodeURIComponent(meta)}-->`);
      }
      (part as { text: string }).text = out.join("");
    }
  }
}

// Aggressive per-part field stripping for opencode's persisted-but-unused
// metadata. Each entry is a path INSIDE a part object (under either `part`
// or `part.data` for the newer/older opencode shapes); the field is
// deleted from every matching part. Confirmed unused by grep across
// apps/web/src - the chat renderer reads only icon + label + details
// computed from state.input.* (see formatToolCall in routes/_app/session/$id.tsx)
// plus state.metadata.todos for todowrite (see lib/todos.ts).
//
// Drops by category:
//
//   reasoning parts: metadata.anthropic.signature - the Anthropic
//   extended-thinking signature opencode keeps for retry replays. Portal
//   never feeds messages back into opencode (opencode reads its own
//   SQLite for retries), so the signature is dead weight on the wire.
//   Dominant cost on most sessions: ~3 KB per reasoning part, 30+ parts
//   per session => 100+ KB just from this.
//
//   every tool: state.output - the model's view of the tool result. The
//   frontend ToolCallItem only renders header (icon/label/details from
//   state.input). webfetch/websearch outputs are 5-16 KB each.
//
//   bash tool: three duplicated mirrors of input.command/description -
//   state.title, state.metadata.description, state.metadata.output. All
//   verified identical in user-AI corpus analysis.
//
//   edit tool: state.metadata.diff and state.metadata.filediff (whose
//   .patch is identical to .diff). The patch text is verified-unused.
//
//   write tool: state.metadata.filepath - dup of state.input.filePath.
//
//   read tool: state.metadata.preview - file-content snippet, unused.
//
//   step parts: data.snapshot - git working-tree snapshot, unused.
//
// Note: state.metadata is not dropped wholesale because todowrite stores
// its parsed todo array there and lib/todos.ts reads it.
function stripPartBloat(messages: unknown): void {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      stripOnePartBloat(part);
    }
  }
}

function stripOnePartBloat(part: unknown): void {
  if (!part || typeof part !== "object") return;
  const p = part as Record<string, unknown> & {
    type?: string;
    state?: Record<string, unknown> & { metadata?: Record<string, unknown> };
    data?: { state?: Record<string, unknown> & { metadata?: Record<string, unknown> }; snapshot?: unknown };
    metadata?: { anthropic?: { signature?: unknown } };
    snapshot?: unknown;
  };

  if (p.type === "reasoning") {
    if (p.metadata?.anthropic && "signature" in p.metadata.anthropic) {
      delete p.metadata.anthropic.signature;
    }
    const inner = (p.data as { metadata?: { anthropic?: { signature?: unknown } } } | undefined)
      ?.metadata?.anthropic;
    if (inner && "signature" in inner) delete inner.signature;
  }

  if (p.type === "step-start" || p.type === "step-finish") {
    if ("snapshot" in p) delete p.snapshot;
    if (p.data && "snapshot" in p.data) delete p.data.snapshot;
  }

  for (const state of partStates(p)) {
    if (!state || typeof state !== "object") continue;
    if ("output" in state) delete state.output;
    if ("title" in state) delete state.title;
    stripHeavyInputFields(state, p.type);
    const meta = state.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta === "object") {
      for (const k of [
        "output",
        "description",
        "diff",
        "filediff",
        "filepath",
        "preview",
      ]) {
        if (k in meta) delete meta[k];
      }
    }
  }
}

// Tool-specific heavy input-field stripping. The per-part ajax endpoint
// (/api/opencode/<port>/session/<id>/part-input) is the one that
// returns the full input on demand when the user expands a tool call.
// On the wire to the chat-list renderer, only the small fields that
// formatToolCall needs to build the row label survive.
//
// Edit's line counts are precomputed into the SMALL fields _oldLines /
// _newLines because formatToolCall renders '(+N-M)' details and would
// otherwise lose the per-edit signal.
function stripHeavyInputFields(
  state: Record<string, unknown>,
  partType: string | undefined,
): void {
  if (partType !== "tool") return;
  const input = state.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return;
  const tool = String((state.tool ?? state.name ?? "") || "").toLowerCase();
  if (tool === "edit") {
    if (typeof input.oldString === "string") {
      (input as Record<string, unknown>)._oldLines =
        (input.oldString as string).split("\n").length;
      delete input.oldString;
    }
    if (typeof input.newString === "string") {
      (input as Record<string, unknown>)._newLines =
        (input.newString as string).split("\n").length;
      delete input.newString;
    }
  } else if (tool === "write") {
    if (typeof input.content === "string") {
      (input as Record<string, unknown>)._contentLines =
        (input.content as string).split("\n").length;
      delete input.content;
    }
  } else if (tool === "task") {
    if (typeof input.prompt === "string") {
      delete input.prompt;
    }
  }
}

function partStates(p: {
  state?: Record<string, unknown>;
  data?: { state?: Record<string, unknown> };
}): Array<Record<string, unknown> | undefined> {
  return [p.state, p.data?.state];
}

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
