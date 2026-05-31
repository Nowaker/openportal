import {
  defineHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "nitro/h3";
import { parsePort, parseRouteParam } from "../../../../lib/validation";
import {
  getCachedMessages,
  getStaleMessages,
  messagesAfter,
} from "../../../../lib/messages-cache";
import { fetchAndCacheMessages } from "../../../../lib/messages-refresh";
import {
  listVisiblePromptsForSession,
  type PromptRow,
} from "../../../../lib/prompt-archive";
import {
  listSynthetic,
  type SyntheticMessageRow,
} from "../../../../lib/synthetic-messages";

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
//
// The fetch + strip + cache pipeline lives in
// apps/web/src/server/lib/messages-refresh.ts. Both this handler and
// the indicator-broadcaster plugin call into it so the cache contents
// are byte-identical regardless of producer.
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
  // Stale-while-revalidate semantics:
  //   1. Fresh cache (TTL'd) -> serve immediately, no opencode call.
  //   2. Stale cache exists (LRU'd, ignores TTL) -> serve stale
  //      immediately, kick off background refresh that updates cache.
  //      User sees data instantly; cache updates on next poll.
  //   3. No cache at all (cold load, post-restart) -> block + fetch.
  //      Only block path that can fail; falls through to virtuals
  //      below if any pending prompts exist for this session.
  // Per user 'caching proxy' directive: openportal owns the view of
  // the world. Opencode slowness/failure NEVER clears cache. Cache only
  // updates when opencode AUTHORITATIVELY responds with new data.
  // Stale-while-revalidate: serve any cache we have (fresh OR stale)
  // before awaiting opencode. Background refresh keeps the cache warm
  // without blocking the response. Only block-and-wait when cache is
  // truly empty (first-ever fetch for this session). This is the
  // 'caching proxy' invariant - openportal serves its own view of the
  // world and updates it as opencode reports changes.
  //
  // Cache freshness is ALSO kept warm by the indicator-broadcaster
  // plugin (apps/web/src/server/plugins/indicator-broadcaster.ts),
  // which calls scheduleRefreshMessages() on every message.part.delta
  // / message.part.updated / message.updated event. So even a session
  // the frontend isn't currently polling stays current as long as
  // opencode emits events for it - the user returning to a previously
  // visited session sees no stale-window-on-return latency.
  const fresh = forceRefresh ? null : getCachedMessages(id);
  const stale = forceRefresh ? null : getStaleMessages(id);
  let real: unknown[] | null = fresh;
  let opencodeUnreachable = false;
  if (fresh === null && stale !== null) {
    real = stale;
    void fetchAndCacheMessages(port, id).catch(() => {
      /* Silent: cache holds the last authoritative state; next poll
         retries. Failure here MUST NOT clear the user's chat log. */
    });
  }
  if (real === null) {
    try {
      real = await fetchAndCacheMessages(port, id);
    } catch {
      real = getStaleMessages(id);
      opencodeUnreachable = true;
      setResponseHeader(event, "X-OpenPortal-OpenCode-Down", "true");
    }
  }
  const visible = listVisiblePromptsForSession(id);
  if (real === null && visible.length === 0) {
    if (opencodeUnreachable) throw new MessagesUnavailableError();
    return [];
  }
  if (real === null) real = [];
  stampTurnStartTimes(real);
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
  //   pass 0 (LEGACY-ONLY): match by opencode_message_id. Until the
  //     no-pre-gen rule landed, portal stamped its own messageID into
  //     prompt_async/command and stored it on the archive row;
  //     opencode echoed it back, making this match bulletproof.
  //     Per AGENTS.md ("Never pre-generate opencode-assigned IDs"),
  //     new rows ALWAYS have opencode_message_id=NULL, so this branch
  //     only fires for rows archived before the rule landed. Kept so
  //     legacy rows still dedup cleanly.
  //   pass 1: text match (primary path for all new rows).
  //   pass 2: slash-command defence (text-shape drift, e.g. `/foo`
  //     archive vs expanded template text).
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
  // Synthetic messages from the /btw side-question feature live in
  // openportal's own SQLite and are NEVER part of opencode's message
  // stream. Wrap them in an opencode-shaped object so MessageItem
  // renders them like any other user/assistant message; the
  // `info._synthetic` flag lets the frontend apply distinct styling
  // (per AI_TODO #138: green-question with /btw prefix label,
  // mid-color answer between user-prompt bg and chat-log bg).
  const synthRows = listSynthetic(id);
  const synthMessages = synthRows.map(toSyntheticChatMessage);
  const merged =
    filtered.length === 0 ? real : [...real, ...filtered];
  return synthMessages.length === 0 ? merged : [...merged, ...synthMessages];
}

type MutableMessage = {
  info?: {
    id?: string;
    role?: string;
    parentID?: string;
    time?: { created?: number; completed?: number };
    _turnStartTime?: number;
  };
};

function stampTurnStartTimes(messages: unknown[]): void {
  const createdById = new Map<string, number>();
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const info = (m as MutableMessage).info;
    if (!info) continue;
    if (typeof info.id !== "string") continue;
    const created = info.time?.created;
    if (typeof created !== "number") continue;
    createdById.set(info.id, created);
  }
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const info = (m as MutableMessage).info;
    if (!info || info.role !== "assistant") continue;
    const parentId = info.parentID;
    if (typeof parentId !== "string") continue;
    const parentCreated = createdById.get(parentId);
    if (typeof parentCreated !== "number") continue;
    info._turnStartTime = parentCreated;
  }
}

function toSyntheticChatMessage(row: SyntheticMessageRow): unknown {
  const msgId = `synthetic::${row.id}`;
  // completed_at IS NULL + _pending sentinel reuses the existing
  // in-flight ("Thinking...") indicator path; see toVirtualUserMessage.
  const completed = row.completed_at ?? null;
  const isPending = completed === null;
  return {
    info: {
      id: msgId,
      sessionID: row.parent_session_id,
      role: row.role,
      time: { created: row.created_at, completed },
      _synthetic: true,
      _btw_index: row.btw_index,
      _btw_fork_session_id: row.fork_session_id,
      ...(isPending
        ? {
            _pending: {
              attempts: 0,
              lastAttemptAt: row.created_at,
              lastError: null,
              archiveId: row.id,
              phase: "opencode-accepted" as const,
            },
          }
        : {}),
    },
    parts: row.text
      ? [
          {
            id: `${msgId}::p0`,
            messageID: msgId,
            sessionID: row.parent_session_id,
            type: "text",
            text: row.text,
          },
        ]
      : [],
  };
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
function toVirtualUserMessage(
  row: PromptRow,
  effectiveCreated?: number,
): unknown {
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

function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_INITIAL_LIMIT;
  }
  if (raw === "all" || raw === "0") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_INITIAL_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
