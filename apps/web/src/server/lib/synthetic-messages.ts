// Openportal-owned chat-log entries for the /btw side-question feature.
//
// These rows live alongside opencode messages in the parent session's
// chat log but are NEVER sent to opencode and NEVER appear in opencode's
// conversation history of the parent. Each /btw invocation writes TWO
// rows sharing the same btw_index: one role='user' (the question) and
// one role='assistant' (the answer harvested from a backgrounded,
// archived fork). The chat-log merge in messages.ts injects them by
// created_at order alongside opencode messages.
//
// completed_at semantics (migration 0006):
//   - completed_at IS NOT NULL  -> message is final
//   - completed_at IS NULL      -> in-flight (assistant only - the user
//                                   question always inserts completed)
// The messages.ts wrapper maps completed_at -> info.time.completed
// so the chat log renders the in-flight assistant via the existing
// "Thinking..." indicator pattern without any frontend change.

import { randomUUID } from "node:crypto";
import { getPromptDb } from "./prompt-db";

export interface SyntheticMessageRow {
  id: string;
  parent_session_id: string;
  ordinal: number;
  btw_index: number;
  role: "user" | "assistant";
  text: string;
  fork_session_id: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface InsertSyntheticInput {
  parentSessionId: string;
  btwIndex: number;
  role: "user" | "assistant";
  text: string;
  forkSessionId?: string | null;
  // Default: completed at insert time. Pass `pending: true` to
  // insert with completed_at=NULL so the frontend renders an
  // in-flight indicator until updateSyntheticAnswer fills it.
  pending?: boolean;
}

export function insertSynthetic(input: InsertSyntheticInput): SyntheticMessageRow {
  const db = getPromptDb();
  const maxRow = db
    .prepare(
      `SELECT MAX(ordinal) AS m FROM synthetic_messages WHERE parent_session_id = ?`,
    )
    .get(input.parentSessionId) as { m: number | null } | undefined;
  const ordinal = (maxRow?.m ?? -1) + 1;
  const now = Date.now();
  const row: SyntheticMessageRow = {
    id: randomUUID(),
    parent_session_id: input.parentSessionId,
    ordinal,
    btw_index: input.btwIndex,
    role: input.role,
    text: input.text,
    fork_session_id: input.forkSessionId ?? null,
    created_at: now,
    completed_at: input.pending ? null : now,
  };
  db.prepare(
    `INSERT INTO synthetic_messages
       (id, parent_session_id, ordinal, btw_index, role, text,
        fork_session_id, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.parent_session_id,
    row.ordinal,
    row.btw_index,
    row.role,
    row.text,
    row.fork_session_id,
    row.created_at,
    row.completed_at,
  );
  return row;
}

// Fill in a pending assistant row with the final answer text.
// Sets completed_at=Date.now() and stamps the fork session id so
// the chat-log entry can later link back to the archived fork.
export function updateSyntheticAnswer(
  id: string,
  text: string,
  forkSessionId: string | null,
): void {
  const db = getPromptDb();
  db.prepare(
    `UPDATE synthetic_messages
       SET text = ?, fork_session_id = ?, completed_at = ?
       WHERE id = ?`,
  ).run(text, forkSessionId, Date.now(), id);
}

export function listSynthetic(parentSessionId: string): SyntheticMessageRow[] {
  const db = getPromptDb();
  return db
    .prepare(
      `SELECT * FROM synthetic_messages
         WHERE parent_session_id = ?
         ORDER BY created_at ASC, ordinal ASC`,
    )
    .all(parentSessionId) as SyntheticMessageRow[];
}

// Counter shared between the question row + the answer row of one
// /btw exchange. Persists across openportal restarts because it's
// derived from the SQLite max. Counts pairs, not rows - we increment
// once per exchange and stamp both rows with the result.
export function nextBtwIndex(parentSessionId: string): number {
  const db = getPromptDb();
  const row = db
    .prepare(
      `SELECT MAX(btw_index) AS m FROM synthetic_messages WHERE parent_session_id = ?`,
    )
    .get(parentSessionId) as { m: number | null } | undefined;
  return (row?.m ?? 0) + 1;
}
