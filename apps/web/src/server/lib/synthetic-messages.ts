// Openportal-owned chat-log entries for the /btw side-question feature.
//
// These rows live alongside opencode messages in the parent session's
// chat log but are NEVER sent to opencode and NEVER appear in opencode's
// conversation history of the parent. Each /btw invocation writes TWO
// rows sharing the same btw_index: one role='user' (the question) and
// one role='assistant' (the answer harvested from a backgrounded,
// archived fork). The chat-log merge in messages.ts injects them by
// created_at order alongside opencode messages.

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
}

export interface InsertSyntheticInput {
  parentSessionId: string;
  btwIndex: number;
  role: "user" | "assistant";
  text: string;
  forkSessionId?: string | null;
}

export function insertSynthetic(input: InsertSyntheticInput): SyntheticMessageRow {
  const db = getPromptDb();
  const maxRow = db
    .prepare(
      `SELECT MAX(ordinal) AS m FROM synthetic_messages WHERE parent_session_id = ?`,
    )
    .get(input.parentSessionId) as { m: number | null } | undefined;
  const ordinal = (maxRow?.m ?? -1) + 1;
  const row: SyntheticMessageRow = {
    id: randomUUID(),
    parent_session_id: input.parentSessionId,
    ordinal,
    btw_index: input.btwIndex,
    role: input.role,
    text: input.text,
    fork_session_id: input.forkSessionId ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO synthetic_messages
       (id, parent_session_id, ordinal, btw_index, role, text, fork_session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.parent_session_id,
    row.ordinal,
    row.btw_index,
    row.role,
    row.text,
    row.fork_session_id,
    row.created_at,
  );
  return row;
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
