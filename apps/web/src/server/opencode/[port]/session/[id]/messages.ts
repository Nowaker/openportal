import {
  defineHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "nitro/h3";
import {
  fetchOpencode,
  getOpencodeClient,
} from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import { stashDataUrl, hasCachedThumb } from "../../../../lib/blob-cache";
import {
  getCachedMessages,
  setCachedMessages,
  getStaleMessages,
  messagesAfter,
} from "../../../../lib/messages-cache";
import { parseOmoBlocks } from "../../../../../lib/omo-injection";
import { putOmoBody } from "../../../../lib/omo-strip-cache";
import { getDecisionsForMessage } from "../../../../lib/permission-audit";
import { getToolOutputMaxBytes } from "../../../../lib/instance-settings-state";
import {
  getContentSettings,
  type ContentRule,
  type ContentSettings,
} from "../../../../lib/content-settings-state";
import {
  listPendingPromptsForSession,
  listVisiblePromptsForSession,
  type PromptRow,
} from "../../../../lib/prompt-archive";

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
  // ?onlyUser=1 filters the response to role==="user" messages BEFORE
  // applying limit/before/after/id slicing. The full session is still
  // cached unfiltered (so untoggling the flag is a free cache hit), but
  // pagination math (slicing, X-Target-Index, X-Messages-Total) runs
  // against the filtered view. Lets the chat "show prompts only" toggle
  // page through user messages without dragging thousands of tool calls
  // over the wire just to filter them out client-side.
  const onlyUser =
    query.onlyUser === "1" ||
    query.onlyUser === "true" ||
    query.onlyUser === "yes";

  let full: unknown[];
  try {
    full = await loadFullMessages(port, id, event, /*forceRefresh*/ false);
  } catch (err) {
    if (err instanceof MessagesUnavailableError) {
      setResponseStatus(event, 503);
      setResponseHeader(event, "X-OpenPortal-OpenCode-Down", "true");
      return [];
    }
    throw err;
  }
  let view = onlyUser ? full.filter(isUserMessage) : full;
  setResponseHeader(event, "X-Messages-Total-Raw", String(full.length));

  const permalinkAnchor = targetId ?? beforeId ?? afterId;
  if (permalinkAnchor !== null) {
    let idx = indexOfMessageId(view, permalinkAnchor);
    if (idx < 0) {
      full = await loadFullMessages(port, id, event, /*forceRefresh*/ true);
      view = onlyUser ? full.filter(isUserMessage) : full;
      idx = indexOfMessageId(view, permalinkAnchor);
      setResponseHeader(event, "X-Messages-Total-Raw", String(full.length));
    }
    setResponseHeader(event, "X-Messages-Total", String(view.length));
    setResponseHeader(event, "X-Target-Found", idx >= 0 ? "true" : "false");
    if (idx >= 0) {
      setResponseHeader(event, "X-Target-Index", String(idx));
    }
    if (targetId !== null) {
      return idx >= 0 ? [view[idx]] : [];
    }
    if (beforeId !== null) {
      if (idx < 0) return [];
      const n = parsePositiveLimit(query.limit, 10);
      const start = Math.max(0, idx - n);
      return view.slice(start, idx);
    }
    if (afterId !== null) {
      if (idx < 0) return [];
      const n = parsePositiveLimit(query.limit, 10);
      const end = Math.min(view.length, idx + 1 + n);
      return view.slice(idx + 1, end);
    }
  }

  if (since) {
    let after = messagesAfter(full, since);
    if (after === null) {
      full = await loadFullMessages(port, id, event, /*forceRefresh*/ true);
      after = messagesAfter(full, since);
      view = onlyUser ? full.filter(isUserMessage) : full;
    }
    const tail = after ?? full;
    return onlyUser ? tail.filter(isUserMessage) : tail;
  }

  setResponseHeader(event, "X-Messages-Total", String(view.length));
  if (limit === undefined) return view;
  return view.slice(-limit);
});

type EventLike = Parameters<Parameters<typeof defineHandler>[0]>[0];

// Thrown when opencode is unreachable AND we have nothing to serve (no
// stale cache, no pending-prompt virtuals). The outer handler catches
// this and returns 503 so SWR's default error-retains-data behavior
// preserves the user's loaded chat log instead of overwriting it with
// "No messages yet". Without this signal a successful 200 with an
// empty body would let SWR replace previousData, clearing the UI on
// every slow/timed-out poll. The user's invariant for low-connectivity
// mode: 'you must not clear any loaded content when opencode connection
// sucks.'
class MessagesUnavailableError extends Error {
  constructor() {
    super("opencode unreachable and no cached or pending data");
    this.name = "MessagesUnavailableError";
  }
}

// Single entry point that combines real opencode messages with
// virtual pending-prompt messages and degrades gracefully when
// opencode is unreachable:
//
//   1. Try memory cache (fresh, TTL-checked).
//   2. On miss, fetch from opencode + cache the result.
//   3. If the fetch throws (opencode down / network blip), fall back
//      to the stale memory cache (ignore TTL) and set
//      `X-OpenPortal-OpenCode-Down: true` so the client can render an
//      "offline" indicator.
//   4. If even the stale cache is empty, return [] for the real list
//      so the user still sees their pending submissions below.
//   5. Append virtual user-role messages built from every pending
//      prompt row for this session - so pending prompts render
//      inline in the chat instead of in a separate banner, AND they
//      keep rendering even when opencode is down.
//
// forceRefresh=true bypasses the fresh cache check (permalink-miss
// and since-marker-miss paths) but does NOT change the stale-fallback
// behaviour.
async function loadFullMessages(
  port: number,
  id: string,
  event: EventLike,
  forceRefresh: boolean,
): Promise<unknown[]> {
  let real: unknown[] | null = forceRefresh ? null : getCachedMessages(id);
  let opencodeTimedOut = false;
  if (real === null) {
    try {
      real = await fetchAndCache(port, id);
    } catch (err) {
      real = getStaleMessages(id);
      opencodeTimedOut = err instanceof FetchTimeoutError;
      setResponseHeader(event, "X-OpenPortal-OpenCode-Down", "true");
    }
  }
  const visible = listVisiblePromptsForSession(id);
  if (real === null && visible.length === 0) {
    if (opencodeTimedOut) throw new MessagesUnavailableError();
    return [];
  }
  if (real === null) real = [];
  if (visible.length === 0) return real;
  // Dedup pass 1: text match. Drop any virtual whose raw_text
  // matches a real user message that landed AFTER the prompt was
  // captured. Without this the user briefly sees their submission
  // TWICE - once as the server-emitted message, once as the
  // still-grace-windowed virtual.
  //
  // Dedup pass 2 (slash-command defence): drop virtuals whose
  // raw_text starts with '/' when ANY real user message arrived
  // after the archive timestamp. Slash commands cause opencode to
  // expand the template and emit a user message with text that
  // does NOT match the archived '/foo bar' string, so pass 1 fails
  // for them. Without pass 2 the user sees the literal slash
  // command alongside the expanded prompt - the dup-prompt bug.
  // A 2s grace window absorbs sub-second race between portal's
  // ts_ms and opencode's created (clocks + ordering).
  const realUserSnippets = new Set<string>();
  const realUserIds = new Set<string>();
  let latestRealUserMs = 0;
  let latestRealAnyMs = 0;
  for (const m of real) {
    if (!m || typeof m !== "object") continue;
    const msg = m as {
      info?: { role?: string; id?: string; time?: { created?: number } };
      parts?: unknown[];
    };
    const created = msg.info?.time?.created ?? 0;
    if (created > latestRealAnyMs) latestRealAnyMs = created;
    if (msg.info?.role !== "user") continue;
    if (typeof msg.info?.id === "string") realUserIds.add(msg.info.id);
    const text = collectUserText(msg.parts).trim();
    if (text.length === 0) continue;
    realUserSnippets.add(text);
    if (created > latestRealUserMs) latestRealUserMs = created;
  }
  // Bump every virtual's effective `created` to AFTER the most recent
  // real message in the session. Without this, a queued virtual whose
  // archive timestamp is older than the currently-thinking assistant
  // message sorts ABOVE the assistant in the chat log - the user's
  // queued prompt visually appears 'before' the in-flight turn, which
  // is wrong: a queued message is FUTURE work, the in-flight turn is
  // CURRENT, so the queued entry must render LAST. The frontend sort
  // in use-session-messages.ts mergeByIdSorted compares time.created
  // ascending, so virtual ts_ms is normalised to max-real-created + 1
  // ms (or kept at row.ts_ms if it was already later than that).
  // Dedup priority:
  //   pass 0 (NEW): match by opencode_message_id. When portal generated
  //     the messageID up-front and passed it to opencode in
  //     prompt_async/command, opencode stamps the user message with
  //     that exact ID. ID match is bulletproof - immune to slash-
  //     command template expansion or any other text shape drift.
  //   pass 1: text match (legacy). Required for rows archived before
  //     this commit whose opencode_message_id is NULL.
  //   pass 2: slash-command defence (legacy). Required for rows whose
  //     ID match somehow missed AND the text doesn't match.
  const filtered = visible
    .filter((row) => {
      if (row.opencode_message_id && realUserIds.has(row.opencode_message_id)) {
        return false;
      }
      if (realUserSnippets.has(row.raw_text.trim())) return false;
      if (
        row.raw_text.startsWith("/") &&
        latestRealUserMs >= row.ts_ms - 2_000
      ) {
        return false;
      }
      return true;
    })
    .map((row) =>
      toVirtualUserMessage(row, Math.max(row.ts_ms, latestRealAnyMs + 1)),
    );
  return filtered.length === 0 ? real : [...real, ...filtered];
}

function collectUserText(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as { type?: string; text?: unknown };
    if (part.type === "text" && typeof part.text === "string") {
      chunks.push(part.text);
    }
  }
  return chunks.join("");
}

// Promote a pending-prompt SQLite row into a synthetic chat-message
// shape. The frontend treats it like any other user message but
// also reads the `_pending` flag on info to render the
// "Waiting for OpenCode" badge + retry/age affordance.
//
// id prefix `pending::` makes virtuals identifiable without
// inspecting `_pending`, which matters for the star/permalink/since
// paths (they key off `info.id`).
function toVirtualUserMessage(row: PromptRow, effectiveCreated?: number): unknown {
  // Phase tracks the actual server-side delivery state, not an
  // optimistic guess. UI maps:
  //   pending  -> "Submitting"     (portal has it, worker hasn't dispatched)
  //   delivered -> "Sent to OpenCode" (worker 204'd from promptAsync)
  //   failed   -> "Failed"          (UI surfaces lastError separately)
  const phase: "submitting" | "opencode-accepted" | "failed" =
    row.status === "delivered"
      ? "opencode-accepted"
      : row.status === "failed"
        ? "failed"
        : "submitting";
  return {
    info: {
      id: `pending::${row.id}`,
      role: "user",
      time: { created: effectiveCreated ?? row.ts_ms, completed: null },
      _pending: {
        attempts: row.attempts,
        lastAttemptAt: row.last_attempt_at,
        lastError: row.last_error,
        archiveId: row.id,
        phase,
      },
    },
    parts: [
      {
        type: "text",
        text: row.raw_text,
      },
    ],
  };
}

function isUserMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as { info?: { role?: string } };
  return m.info?.role === "user";
}

function permalinkResponse(
  event: Parameters<Parameters<typeof defineHandler>[0]>[0],
  list: unknown[],
  idx: number,
  targetId: string | null,
  beforeId: string | null,
  afterId: string | null,
  query: ReturnType<typeof getQuery>,
): unknown[] {
  setResponseHeader(event, "X-Messages-Total", String(list.length));
  setResponseHeader(event, "X-Target-Found", idx >= 0 ? "true" : "false");
  if (idx >= 0) {
    setResponseHeader(event, "X-Target-Index", String(idx));
  }
  if (targetId !== null) {
    return idx >= 0 ? [list[idx]] : [];
  }
  if (beforeId !== null) {
    if (idx < 0) return [];
    const n = parsePositiveLimit(query.limit, 10);
    const start = Math.max(0, idx - n);
    return list.slice(start, idx);
  }
  if (afterId !== null) {
    if (idx < 0) return [];
    const n = parsePositiveLimit(query.limit, 10);
    const end = Math.min(list.length, idx + 1 + n);
    return list.slice(idx + 1, end);
  }
  return [];
}

function isTruthyParam(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const s = raw.toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }
  if (Array.isArray(raw)) return raw.some(isTruthyParam);
  return false;
}

function filterUserMessages(messages: unknown[]): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter((m) => {
    if (!m || typeof m !== "object") return false;
    const info = (m as { info?: { role?: string } }).info;
    return info?.role === "user";
  });
}

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

// SDK-first with a raw-fetch fallback for defense in depth.
//
// Background: at one point opencode itself returned HTTP 400 for the
// entire /session/{id}/message response when even one message in the
// session failed its effect-schema validation (the stuck-compaction-
// fixer was emitting synthetic recovery messages without info.agent /
// info.model / info.summary - the validation tripped on those and
// rejected the whole array). That blank-screened the recovered
// sessions in any SDK consumer.
//
// The upstream issue has been fixed (opencode-tools commit 39f98fb +
// in-place DB backfill of the four affected rows). Reverted to the
// SDK call as the default path because it's the canonical client and
// the most surface for any future schema changes opencode adds. The
// raw-fetch fallback kicks in iff the SDK returns an error envelope
// (the SDK doesn't throw on schema mismatch - it sets result.error
// instead) AND the raw endpoint accepts a limit cap that excludes
// whatever the SDK is choking on. Defense in depth.
const FALLBACK_FETCH_LIMIT = 1000;

// Fast-fail timeout so a slow/down opencode does NOT block the
// browser's /messages fetch on cold load. Without this, refreshing
// the page when opencode is sick would leave the chat log spinner
// up for the full SDK timeout (potentially 30+ seconds), and the
// user's pending-backlog virtuals would not render until then. With
// the timeout, fetchAndCache throws on 3s and the caller's catch
// falls through to getStaleMessages + virtuals, satisfying the user
// invariant 'MUST SEND CONTENT TO OP FRONTEND, WHATEVER THE SOURCE,
// ASAP'.
const FETCH_TIMEOUT_MS = 3_000;

class FetchTimeoutError extends Error {
  constructor() {
    super(`opencode session.messages timed out after ${FETCH_TIMEOUT_MS}ms`);
    this.name = "FetchTimeoutError";
  }
}

async function fetchAndCache(port: number, id: string): Promise<unknown[]> {
  const client = await getOpencodeClient(port);
  const result = await Promise.race([
    client.session.messages({ path: { id } }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new FetchTimeoutError()), FETCH_TIMEOUT_MS),
    ),
  ]);
  const data = (result as { data?: unknown }).data;
  let raw: unknown[];
  if (Array.isArray(data)) {
    raw = data;
  } else {
    const err = (result as { error?: { name?: string; data?: unknown } }).error;
    const status = (result as { response?: { status?: number } }).response
      ?.status;
    console.warn(
      `[messages] SDK rejected /session/${id}/message ` +
        `(status=${status ?? "?"} error=${err?.name ?? "unknown"}); ` +
        `falling back to raw fetch with limit=${FALLBACK_FETCH_LIMIT}`,
    );
    const res = await fetchOpencode(
      port,
      `/session/${encodeURIComponent(id)}/message?limit=${FALLBACK_FETCH_LIMIT}`,
    );
    if (!res.ok) {
      throw new Error(
        `opencode /session/${id}/message fallback returned ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json().catch(() => null)) as unknown;
    raw = Array.isArray(body) ? body : [];
  }

  const stripped = stripDiagnosticFixes(raw);
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
  const legacyCap = getToolOutputMaxBytes();
  const content = getContentSettings();
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      stripOnePartBloat(part, legacyCap, content);
    }
  }
}

function stripOnePartBloat(
  part: unknown,
  legacyCap: number | null,
  content: ContentSettings,
): void {
  if (!part || typeof part !== "object") return;
  const p = part as Record<string, unknown> & {
    type?: string;
    text?: string;
    state?: Record<string, unknown> & { metadata?: Record<string, unknown> };
    data?: {
      state?: Record<string, unknown> & { metadata?: Record<string, unknown> };
      text?: string;
      snapshot?: unknown;
    };
    metadata?: { anthropic?: { signature?: unknown } };
    snapshot?: unknown;
    synthetic?: unknown;
    ignored?: unknown;
  };

  if (p.type === "reasoning") {
    if (p.metadata?.anthropic && "signature" in p.metadata.anthropic) {
      delete p.metadata.anthropic.signature;
    }
    const inner = (p.data as { metadata?: { anthropic?: { signature?: unknown } } } | undefined)
      ?.metadata?.anthropic;
    if (inner && "signature" in inner) delete inner.signature;
    applyTextRule(p, content.rules.reasoning, "reasoning");
  }

  if (p.type === "step-start" || p.type === "step-finish") {
    if ("snapshot" in p) delete p.snapshot;
    if (p.data && "snapshot" in p.data) delete p.data.snapshot;
  }

  if (p.type === "text" && p.synthetic === true && p.ignored === true) {
    applyTextRule(p, content.rules["synthetic-marker"], "synthetic-marker");
  }

  for (const state of partStates(p)) {
    if (!state || typeof state !== "object") continue;
    const outputRule = content.rules["tool-call-output"];
    const outputCap = effectiveCap(outputRule, legacyCap);
    applyValueRule(state, "output", outputRule, outputCap, "tool-call-output");
    if ("title" in state) delete state.title;
    stripHeavyInputFields(state, p.type);
    const meta = state.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta === "object") {
      applyValueRule(meta, "output", outputRule, outputCap, "tool-call-output");
      for (const k of ["description", "diff", "filediff", "filepath", "preview"]) {
        if (k in meta) delete meta[k];
      }
    }
  }
}

// Pre-Section-I behavior: legacyCap was the single global tool-output cap.
// Post-Section-I-2: the per-content-type rule wins when set; legacyCap is
// the fallback used only when the rule for "tool-call-output" is at its
// show-fully default. This preserves backwards compat for users who have
// only the legacy knob configured, without double-truncating users who
// have set the new rule.
function effectiveCap(rule: ContentRule, legacyCap: number | null): number | null {
  if (rule.visibility === "show-fully") return legacyCap;
  if (rule.visibility === "hide" || rule.visibility === "ajax-only") return 0;
  return rule.maxBytes;
}

function applyTextRule(
  part: Record<string, unknown>,
  rule: ContentRule,
  hint: string,
): void {
  if (rule.visibility === "show-fully") return;
  const text = typeof part.text === "string" ? part.text : null;
  if (text === null) return;
  if (rule.visibility === "hide") {
    part.text = "";
    part._stripped = { hint, reason: "hide" };
    return;
  }
  if (rule.visibility === "ajax-only") {
    part._stripped = { hint, reason: "ajax-only", bytes: text.length };
    part.text = "";
    return;
  }
  if (rule.maxBytes !== null && text.length > rule.maxBytes) {
    part.text =
      text.slice(0, rule.maxBytes) +
      `\n\n[...truncated ${text.length - rule.maxBytes} bytes - configure in Settings -> Content]`;
    if (rule.visibility === "show-max-bytes-with-ajax") {
      part._stripped = {
        hint,
        reason: "truncated-with-ajax",
        bytes: text.length,
      };
    }
  }
}

function applyValueRule(
  obj: Record<string, unknown>,
  key: string,
  rule: ContentRule,
  effective: number | null,
  hint: string,
): void {
  if (!(key in obj)) return;
  if (effective === null) return;
  if (effective === 0) {
    delete obj[key];
    obj[`_${key}_stripped`] = {
      hint,
      reason: rule.visibility === "hide" ? "hide" : "ajax-only",
    };
    return;
  }
  const v = obj[key];
  if (typeof v === "string") {
    if (v.length > effective) {
      obj[key] =
        v.slice(0, effective) +
        `\n\n[...truncated ${v.length - effective} bytes - configure in Settings -> Content]`;
      if (rule.visibility === "show-max-bytes-with-ajax") {
        obj[`_${key}_stripped`] = {
          hint,
          reason: "truncated-with-ajax",
          bytes: v.length,
        };
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
