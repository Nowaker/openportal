import { randomUUID } from "node:crypto";

import { getOpencodeClient } from "./opencode-client";
import { getPromptDb } from "./prompt-db";
import { filterPrompt } from "./prompt-filter";

export type PromptSource = "prompt" | "command";

export interface ArchiveInput {
  port: number;
  sessionId: string;
  rawText: string;
  modelProvider?: string;
  modelId?: string;
  agent?: string;
  variant?: string;
  source: PromptSource;
  attachmentsCount?: number;
  // Test-mode overrides: bypass the opencode SDK lookup. Production code
  // calls archivePrompt with neither override set so the cached SDK
  // lookup runs; tests pass both to keep the archive module
  // self-contained.
  projectPathOverride?: string;
  parentSessionIdOverride?: string | null;
}

export type PromptStatus = "pending" | "delivered" | "failed" | "sent";

export interface PromptRow {
  id: string;
  ts_ms: number;
  project_path: string;
  session_id: string;
  parent_session_id: string | null;
  raw_text: string;
  raw_text_unfiltered: string;
  model_provider: string | null;
  model_id: string | null;
  agent: string | null;
  variant: string | null;
  source: PromptSource;
  attachments_count: number;
  status: PromptStatus;
  port: number | null;
  payload_json: string | null;
  delivered_at: number | null;
  last_attempt_at: number | null;
  attempts: number;
  last_error: string | null;
}

export const MAX_DELIVERY_ATTEMPTS = 12;
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 60_000;

export interface PendingPayload {
  parts: unknown[];
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
}

export interface ListFilters {
  project?: string;
  session?: string;
  q?: string;
  from?: number;
  to?: number;
  limit?: number;
  cursor?: number;
}

export interface ListResult {
  rows: PromptRow[];
  nextCursor: number | null;
}

interface SessionMeta {
  directory: string;
  parentID: string | null;
}

// session.directory and session.parentID are both immutable per opencode's
// public API (parentID accepted only on create, directory tied to the
// session at creation). Module-scope cache, no eviction.
const sessionMetaCache = new Map<string, SessionMeta>();

async function getSessionMeta(
  port: number,
  sessionId: string,
): Promise<SessionMeta> {
  const cached = sessionMetaCache.get(sessionId);
  if (cached) return cached;
  try {
    const client = await getOpencodeClient(port);
    const resp = await client.session.get({ path: { id: sessionId } });
    const data = resp.data as
      | { directory?: string; parentID?: string | null }
      | undefined;
    const meta: SessionMeta = {
      directory: data?.directory ?? "",
      parentID: data?.parentID ?? null,
    };
    sessionMetaCache.set(sessionId, meta);
    return meta;
  } catch {
    return { directory: "", parentID: null };
  }
}

const INSERT_SQL = `
  INSERT INTO prompts (
    id, ts_ms, project_path, session_id, parent_session_id,
    raw_text, raw_text_unfiltered,
    model_provider, model_id, agent, variant,
    source, attachments_count,
    status, port, payload_json, delivered_at, last_attempt_at, attempts, last_error
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export async function archivePrompt(
  input: ArchiveInput & {
    status?: PromptStatus;
    payload?: PendingPayload;
  },
): Promise<PromptRow | null> {
  const f = filterPrompt(input.rawText);
  if (!f.shouldArchive) return null;

  let projectPath: string;
  let parentSessionId: string | null;
  if (input.projectPathOverride !== undefined) {
    projectPath = input.projectPathOverride;
    parentSessionId = input.parentSessionIdOverride ?? null;
  } else {
    const meta = await getSessionMeta(input.port, input.sessionId);
    projectPath = meta.directory;
    parentSessionId = meta.parentID;
  }

  const status: PromptStatus = input.status ?? "sent";
  const payload_json = input.payload ? JSON.stringify(input.payload) : null;

  const row: PromptRow = {
    id: randomUUID(),
    ts_ms: Date.now(),
    project_path: projectPath,
    session_id: input.sessionId,
    parent_session_id: parentSessionId,
    raw_text: f.filtered,
    raw_text_unfiltered: f.unfiltered,
    model_provider: input.modelProvider ?? null,
    model_id: input.modelId ?? null,
    agent: input.agent ?? null,
    variant: input.variant ?? null,
    source: input.source,
    attachments_count: input.attachmentsCount ?? 0,
    status,
    port: input.port,
    payload_json,
    delivered_at: status === "sent" || status === "delivered" ? Date.now() : null,
    last_attempt_at: null,
    attempts: 0,
    last_error: null,
  };
  try {
    getPromptDb()
      .prepare(INSERT_SQL)
      .run(
        row.id,
        row.ts_ms,
        row.project_path,
        row.session_id,
        row.parent_session_id,
        row.raw_text,
        row.raw_text_unfiltered,
        row.model_provider,
        row.model_id,
        row.agent,
        row.variant,
        row.source,
        row.attachments_count,
        row.status,
        row.port,
        row.payload_json,
        row.delivered_at,
        row.last_attempt_at,
        row.attempts,
        row.last_error,
      );
  } catch (err) {
    console.error("[prompt-archive] insert failed:", err);
    return null;
  }
  return row;
}

export function listPendingPrompts(limit = 50): PromptRow[] {
  const db = getPromptDb();
  return db
    .query(
      `SELECT * FROM prompts WHERE status = 'pending' ORDER BY ts_ms ASC LIMIT ?`,
    )
    .all(limit) as unknown as PromptRow[];
}

export function listPendingPromptsForSession(sessionId: string): PromptRow[] {
  const db = getPromptDb();
  return db
    .query(
      `SELECT * FROM prompts WHERE status = 'pending' AND session_id = ? ORDER BY ts_ms ASC`,
    )
    .all(sessionId) as unknown as PromptRow[];
}

export function markPromptDelivered(id: string): void {
  const db = getPromptDb();
  db.prepare(
    `UPDATE prompts SET status = 'delivered', delivered_at = ?, last_error = NULL WHERE id = ? AND status = 'pending'`,
  ).run(Date.now(), id);
}

export function markPromptFailed(id: string, error: string): void {
  const db = getPromptDb();
  db.prepare(
    `UPDATE prompts SET status = 'failed', last_error = ? WHERE id = ? AND status = 'pending'`,
  ).run(error.slice(0, 2000), id);
}

export function recordDeliveryAttempt(
  id: string,
  error: string | null,
): void {
  const db = getPromptDb();
  db.prepare(
    `UPDATE prompts SET attempts = attempts + 1, last_attempt_at = ?, last_error = ? WHERE id = ?`,
  ).run(Date.now(), error ? error.slice(0, 2000) : null, id);
}

export function backoffMsForAttempts(attempts: number): number {
  const ms = BASE_BACKOFF_MS * 2 ** Math.min(attempts, 10);
  return Math.min(ms, MAX_BACKOFF_MS);
}

export function getPromptById(id: string): PromptRow | null {
  const db = getPromptDb();
  return (
    (db.prepare("SELECT * FROM prompts WHERE id = ?").get(id) as
      | PromptRow
      | null) ?? null
  );
}

export function listPrompts(filters: ListFilters = {}): ListResult {
  const db = getPromptDb();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const params: Array<string | number> = [];
  const where: string[] = [];

  const addEq = (col: string, value: string | undefined) => {
    if (value !== undefined && value !== "") {
      where.push(`${col} = ?`);
      params.push(value);
    }
  };
  const addCmp = (col: string, op: string, value: number | undefined) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      where.push(`${col} ${op} ?`);
      params.push(value);
    }
  };

  // FTS5's MATCH is whole-word-by-default; the user expects substring
  // semantics where 'bleh' matches 'dupableh'. Skip the FTS index and
  // use LIKE '%term%' on the prompts table directly. Slower for large
  // archives but matches user intent; the SQLite linear scan still
  // returns < 100ms for ~10k rows on this DB. Escape LIKE wildcards
  // in the user input ('%', '_', '\') so a literal '%' query doesn't
  // unexpectedly match everything.
  const escapeLike = (s: string): string =>
    s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  let sql = `SELECT * FROM prompts WHERE 1=1`;
  if (filters.q && filters.q.trim().length > 0) {
    where.push(`raw_text LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLike(filters.q.trim())}%`);
  }
  addEq("project_path", filters.project);
  addEq("session_id", filters.session);
  addCmp("ts_ms", ">=", filters.from);
  addCmp("ts_ms", "<=", filters.to);
  addCmp("ts_ms", "<", filters.cursor);
  if (where.length > 0) sql += ` AND ` + where.join(" AND ");
  sql += ` ORDER BY ts_ms DESC LIMIT ?`;
  params.push(limit + 1);

  const rows = db.prepare(sql).all(...params) as PromptRow[];
  const hasMore = rows.length > limit;
  const truncated = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && truncated.length > 0
      ? truncated[truncated.length - 1].ts_ms
      : null;
  return { rows: truncated, nextCursor };
}

export function clearSessionMetaCacheForTesting(): void {
  sessionMetaCache.clear();
}
