// Process-wide indicator state singleton.
//
// One in-memory Map keyed by `${serverId}::${sessionId}` holding the
// user-facing indicator state for every session: busy/idle, pending
// question/permission IDs, last error, todo progress, pending-prompt
// sidecar (virtuals queued for delivery).
//
// Producers:
//   - indicator-broadcaster.ts consumes per-server opencode SSE and
//     calls applyOpencodeEvent() per frame.
//   - pending-prompt-worker.ts + /prompt POST handler call
//     recordPendingPrompt / clearPendingPrompt so the indicator
//     reflects queued-but-undelivered prompts even when opencode
//     hasn't emitted anything yet.
//
// Consumers:
//   - /api/indicators (snapshot) reads getSnapshot().
//   - /api/indicators/stream (SSE) calls subscribe(filter, listener);
//     state mutations fan out to every matching listener.
//
// State mutations copy-on-write the SessionIndicatorState object that
// gets stored AND delivered to subscribers, so listeners may hold the
// reference across React renders without separate snapshot semantics.

export interface IndicatorTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
}

export interface SessionIndicatorState {
  serverId: string;
  port: number;
  sessionId: string;
  busy: boolean;
  idle: boolean;
  lastEventAt: number;
  lastError: string | null;
  pendingQuestionIds: string[];
  pendingPermissionIds: string[];
  todoState: { pending: number; in_progress: number; completed: number } | null;
  todos: IndicatorTodoItem[] | null;
  pendingPromptIds: string[];
  connected: boolean;
  // mode + tool tracking for title-bar status badges. mode === "compaction"
  // when the in-flight assistant is a compaction turn (opencode signals
  // via info.mode === "compaction" on message.created). currentToolName
  // is the name of the running tool when latest in-flight part is
  // a tool part with state.status === "running". inFlightAssistantId
  // anchors both — they only apply to THIS assistant message and clear
  // when it finalizes.
  mode: string | null;
  currentToolName: string | null;
  inFlightAssistantId: string | null;
}

export type SubscriberPayload =
  | { type: "snapshot"; sessions: SessionIndicatorState[] }
  | { type: "update"; state: SessionIndicatorState }
  | { type: "remove"; serverId: string; sessionId: string }
  | { type: "server-connected"; serverId: string }
  | { type: "server-disconnected"; serverId: string };

export interface SubscriberFilter {
  serverId?: string;
  sessionId?: string;
}

type Listener = (payload: SubscriberPayload) => void;

interface Subscription {
  filter: SubscriberFilter;
  listener: Listener;
}

const sessions = new Map<string, SessionIndicatorState>();
const subs = new Set<Subscription>();
const serverConnected = new Map<string, boolean>();

function key(serverId: string, sessionId: string): string {
  return `${serverId}::${sessionId}`;
}

function emptyState(
  serverId: string,
  port: number,
  sessionId: string,
): SessionIndicatorState {
  return {
    serverId,
    port,
    sessionId,
    busy: false,
    idle: true,
    lastEventAt: 0,
    lastError: null,
    pendingQuestionIds: [],
    pendingPermissionIds: [],
    todoState: null,
    todos: null,
    pendingPromptIds: [],
    connected: serverConnected.get(serverId) ?? true,
    mode: null,
    currentToolName: null,
    inFlightAssistantId: null,
  };
}

function ensureState(
  serverId: string,
  port: number,
  sessionId: string,
): SessionIndicatorState {
  const k = key(serverId, sessionId);
  const cur = sessions.get(k);
  if (cur) return cur;
  const fresh = emptyState(serverId, port, sessionId);
  sessions.set(k, fresh);
  return fresh;
}

function matches(
  filter: SubscriberFilter,
  serverId: string,
  sessionId?: string,
): boolean {
  if (filter.serverId && filter.serverId !== serverId) return false;
  if (
    sessionId !== undefined &&
    filter.sessionId &&
    filter.sessionId !== sessionId
  ) {
    return false;
  }
  return true;
}

function deliver(sub: Subscription, payload: SubscriberPayload): void {
  try {
    sub.listener(payload);
  } catch (err) {
    console.warn(
      "[indicator-state] subscriber threw:",
      err instanceof Error ? err.message : err,
    );
  }
}

function fanout(payload: SubscriberPayload): void {
  for (const sub of subs) {
    switch (payload.type) {
      case "snapshot":
        deliver(sub, payload);
        break;
      case "update":
        if (
          matches(sub.filter, payload.state.serverId, payload.state.sessionId)
        ) {
          deliver(sub, payload);
        }
        break;
      case "remove":
        if (matches(sub.filter, payload.serverId, payload.sessionId)) {
          deliver(sub, payload);
        }
        break;
      case "server-connected":
      case "server-disconnected":
        if (matches(sub.filter, payload.serverId)) {
          deliver(sub, payload);
        }
        break;
    }
  }
}

function commit(next: SessionIndicatorState): void {
  sessions.set(key(next.serverId, next.sessionId), next);
  fanout({ type: "update", state: next });
}

interface OpencodeFrame {
  type?: string;
  properties?: Record<string, unknown>;
  time?: number;
}

// Caller supplies (serverId, port) because opencode frames only carry
// sessionID; we need server identity for sidebar grouping and port for
// any downstream callbacks that need to hit the upstream.
export function applyOpencodeEvent(
  serverId: string,
  port: number,
  event: OpencodeFrame,
): void {
  if (!event || typeof event !== "object" || !event.type) return;
  const props = event.properties ?? {};
  const sid = typeof props.sessionID === "string" ? props.sessionID : null;
  if (!sid) return;
  const cur = ensureState(serverId, port, sid);
  const now = event.time ?? Date.now();
  const next: SessionIndicatorState = { ...cur, lastEventAt: now };

  switch (event.type) {
    case "session.status": {
      const info = props.info as
        | { time?: { completed?: number | null } }
        | undefined;
      if (info?.time && typeof info.time === "object") {
        const completed = info.time.completed;
        next.busy =
          completed === null || completed === undefined || completed === 0;
        next.idle = !next.busy;
      }
      break;
    }
    case "session.idle":
      next.busy = false;
      next.idle = true;
      break;
    case "session.error": {
      const err = props.error;
      next.lastError =
        typeof err === "string"
          ? err.slice(0, 500)
          : err && typeof err === "object"
            ? JSON.stringify(err).slice(0, 500)
            : "unknown error";
      next.busy = false;
      next.idle = true;
      break;
    }
    case "session.created":
    case "session.updated":
      break;
    case "session.deleted":
      sessions.delete(key(serverId, sid));
      fanout({ type: "remove", serverId, sessionId: sid });
      return;
    case "question.asked": {
      const info = props.info as { id?: string } | undefined;
      if (info?.id && !next.pendingQuestionIds.includes(info.id)) {
        next.pendingQuestionIds = [...next.pendingQuestionIds, info.id];
      }
      break;
    }
    case "question.replied":
    case "question.rejected": {
      const info = props.info as { id?: string } | undefined;
      if (info?.id) {
        next.pendingQuestionIds = next.pendingQuestionIds.filter(
          (qid) => qid !== info.id,
        );
      }
      break;
    }
    case "permission.asked": {
      const info = props.info as { id?: string } | undefined;
      if (info?.id && !next.pendingPermissionIds.includes(info.id)) {
        next.pendingPermissionIds = [...next.pendingPermissionIds, info.id];
      }
      break;
    }
    case "permission.replied": {
      const info = props.info as { id?: string } | undefined;
      if (info?.id) {
        next.pendingPermissionIds = next.pendingPermissionIds.filter(
          (pid) => pid !== info.id,
        );
      }
      break;
    }
    case "todo.updated": {
      // opencode's todo.updated event has shape
      //   { sessionID: string, todos: TodoInfo[] }
      // (see opencode/packages/opencode/src/session/todo.ts).
      // Earlier versions used a different shape and we read
      // properties.info; that path is dead now and would silently
      // drop every todo update. Read properties.todos.
      const todos = (props.todos ?? props.info) as
        | Array<{ content?: unknown; status?: unknown; priority?: unknown }>
        | undefined;
      if (Array.isArray(todos)) {
        const counts = { pending: 0, in_progress: 0, completed: 0 };
        const items: IndicatorTodoItem[] = [];
        for (const t of todos) {
          if (!t || typeof t !== "object") continue;
          const content = typeof t.content === "string" ? t.content : "";
          if (!content) continue;
          const status =
            t.status === "in_progress" ||
            t.status === "completed" ||
            t.status === "cancelled" ||
            t.status === "pending"
              ? t.status
              : "pending";
          const priority =
            typeof t.priority === "string" ? t.priority : undefined;
          items.push({ content, status, priority });
          if (status === "pending") counts.pending++;
          else if (status === "in_progress") counts.in_progress++;
          else if (status === "completed") counts.completed++;
        }
        next.todoState = counts;
        next.todos = items;
      }
      break;
    }
    case "message.created": {
      const info = props.info as
        | {
            id?: string;
            role?: string;
            mode?: string;
            time?: { completed?: number | null };
          }
        | undefined;
      if (info?.role === "assistant" && typeof info.id === "string") {
        const completed = info.time?.completed;
        const inFlight =
          completed === null || completed === undefined || completed === 0;
        if (inFlight) {
          next.inFlightAssistantId = info.id;
          next.mode = typeof info.mode === "string" ? info.mode : null;
          next.currentToolName = null;
        }
      }
      break;
    }
    case "message.updated": {
      const info = props.info as
        | {
            id?: string;
            role?: string;
            time?: { completed?: number | null };
          }
        | undefined;
      if (
        info?.role === "assistant" &&
        typeof info.id === "string" &&
        info.id === next.inFlightAssistantId
      ) {
        const completed = info.time?.completed;
        if (completed !== null && completed !== undefined && completed !== 0) {
          next.inFlightAssistantId = null;
          next.mode = null;
          next.currentToolName = null;
        }
      }
      break;
    }
    case "message.part.updated": {
      const part = props.part as
        | {
            type?: string;
            tool?: string;
            state?: { status?: string };
            messageID?: string;
          }
        | undefined;
      if (
        part?.type === "tool" &&
        part.messageID === next.inFlightAssistantId
      ) {
        const status = part.state?.status;
        if (status === "running" || status === "pending") {
          next.currentToolName =
            typeof part.tool === "string" ? part.tool : null;
        } else if (status === "completed" || status === "error") {
          if (
            typeof part.tool === "string" &&
            next.currentToolName === part.tool
          ) {
            next.currentToolName = null;
          }
        }
      }
      break;
    }
    case "message.part.delta":
    case "message.part.removed":
    case "message.removed":
      break;
    default:
      return;
  }
  commit(next);
}

export function getSnapshot(
  filter: SubscriberFilter = {},
): SessionIndicatorState[] {
  const out: SessionIndicatorState[] = [];
  for (const s of sessions.values()) {
    if (matches(filter, s.serverId, s.sessionId)) out.push(s);
  }
  return out;
}

export function subscribe(
  filter: SubscriberFilter,
  listener: Listener,
): () => void {
  const sub: Subscription = { filter, listener };
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}

export function setServerConnected(serverId: string, connected: boolean): void {
  const prev = serverConnected.get(serverId);
  if (prev === connected) return;
  serverConnected.set(serverId, connected);
  for (const s of sessions.values()) {
    if (s.serverId === serverId) {
      sessions.set(key(s.serverId, s.sessionId), { ...s, connected });
    }
  }
  fanout(
    connected
      ? { type: "server-connected", serverId }
      : { type: "server-disconnected", serverId },
  );
}

export function recordPendingPrompt(
  serverId: string,
  port: number,
  sessionId: string,
  promptId: string,
): void {
  const cur = ensureState(serverId, port, sessionId);
  if (cur.pendingPromptIds.includes(promptId)) return;
  const next: SessionIndicatorState = {
    ...cur,
    pendingPromptIds: [...cur.pendingPromptIds, promptId],
    busy: true,
    idle: false,
    lastEventAt: Date.now(),
  };
  commit(next);
}

export function setTodos(
  serverId: string,
  port: number,
  sessionId: string,
  todos: IndicatorTodoItem[],
): void {
  const cur = ensureState(serverId, port, sessionId);
  const counts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of todos) {
    if (t.status === "pending") counts.pending++;
    else if (t.status === "in_progress") counts.in_progress++;
    else if (t.status === "completed") counts.completed++;
  }
  const next: SessionIndicatorState = {
    ...cur,
    todos,
    todoState: counts,
    lastEventAt: Date.now(),
  };
  commit(next);
}

export function clearPendingPrompt(
  serverId: string,
  sessionId: string,
  promptId: string,
): void {
  const cur = sessions.get(key(serverId, sessionId));
  if (!cur || !cur.pendingPromptIds.includes(promptId)) return;
  const next: SessionIndicatorState = {
    ...cur,
    pendingPromptIds: cur.pendingPromptIds.filter((id) => id !== promptId),
    lastEventAt: Date.now(),
  };
  commit(next);
}

export function clearForTesting(): void {
  sessions.clear();
  subs.clear();
  serverConnected.clear();
}
