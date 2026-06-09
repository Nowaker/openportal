import { randomUUID } from "node:crypto";
import { getPromptDb } from "./prompt-db";

export type PermissionDecisionValue = "once" | "always" | "reject";

export interface PermissionEventRow {
  id: string;
  server_id: string | null;
  session_id: string;
  request_id: string;
  message_id: string | null;
  call_id: string | null;
  tool_name: string | null;
  permission_type: string | null;
  patterns: string;
  title: string | null;
  status: "pending" | "resolved";
  decision: PermissionDecisionValue | null;
  auto: number;
  asked_at: number;
  decided_at: number | null;
}

export interface RecordAskedInput {
  serverId?: string | null;
  sessionId: string;
  requestId: string;
  messageId?: string | null;
  callId?: string | null;
  toolName?: string | null;
  permissionType?: string | null;
  patterns?: string[];
  title?: string | null;
  askedAt?: number;
}

export interface RecordResolvedInput extends RecordAskedInput {
  decision: PermissionDecisionValue;
  auto: boolean;
  decidedAt?: number;
}

function findRow(
  sessionId: string,
  requestId: string,
): PermissionEventRow | undefined {
  return getPromptDb()
    .prepare(
      `SELECT * FROM permission_events
         WHERE session_id = ? AND request_id = ?`,
    )
    .get(sessionId, requestId) as PermissionEventRow | undefined;
}

export function recordAsked(input: RecordAskedInput): void {
  const db = getPromptDb();
  const existing = findRow(input.sessionId, input.requestId);
  if (existing) return;
  db.prepare(
    `INSERT INTO permission_events
       (id, server_id, session_id, request_id, message_id, call_id,
        tool_name, permission_type, patterns, title, status, asked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    randomUUID(),
    input.serverId ?? null,
    input.sessionId,
    input.requestId,
    input.messageId ?? null,
    input.callId ?? null,
    input.toolName ?? null,
    input.permissionType ?? null,
    JSON.stringify(input.patterns ?? []),
    input.title ?? null,
    input.askedAt ?? Date.now(),
  );
}

export function recordResolved(input: RecordResolvedInput): void {
  const db = getPromptDb();
  const decidedAt = input.decidedAt ?? Date.now();
  const existing = findRow(input.sessionId, input.requestId);
  if (existing) {
    db.prepare(
      `UPDATE permission_events
         SET status = 'resolved',
             decision = ?,
             auto = ?,
             decided_at = ?,
             message_id = COALESCE(message_id, ?),
             call_id = COALESCE(call_id, ?),
             tool_name = COALESCE(tool_name, ?),
             permission_type = COALESCE(permission_type, ?),
             title = COALESCE(title, ?),
             patterns = CASE WHEN patterns = '[]' THEN ? ELSE patterns END
         WHERE id = ?`,
    ).run(
      input.decision,
      input.auto ? 1 : 0,
      decidedAt,
      input.messageId ?? null,
      input.callId ?? null,
      input.toolName ?? null,
      input.permissionType ?? null,
      input.title ?? null,
      JSON.stringify(input.patterns ?? []),
      existing.id,
    );
    return;
  }
  db.prepare(
    `INSERT INTO permission_events
       (id, server_id, session_id, request_id, message_id, call_id,
        tool_name, permission_type, patterns, title, status, decision,
        auto, asked_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resolved', ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.serverId ?? null,
    input.sessionId,
    input.requestId,
    input.messageId ?? null,
    input.callId ?? null,
    input.toolName ?? null,
    input.permissionType ?? null,
    JSON.stringify(input.patterns ?? []),
    input.title ?? null,
    input.decision,
    input.auto ? 1 : 0,
    input.askedAt ?? decidedAt,
    decidedAt,
  );
}

export function listResolvedForSession(
  sessionId: string,
): PermissionEventRow[] {
  return getPromptDb()
    .prepare(
      `SELECT * FROM permission_events
         WHERE session_id = ? AND status = 'resolved'
         ORDER BY asked_at ASC, decided_at ASC`,
    )
    .all(sessionId) as PermissionEventRow[];
}

function parsePatterns(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function yamlScalar(value: string): string {
  if (value === "") return '""';
  if (/^[\w./@:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function permissionEventToYaml(row: PermissionEventRow): string {
  const patterns = parsePatterns(row.patterns);
  const lines: string[] = [
    "```yaml",
    "source: vibekick",
    "kind: permissions",
    `requestId: ${yamlScalar(row.request_id)}`,
  ];
  if (row.tool_name) lines.push(`tool: ${yamlScalar(row.tool_name)}`);
  if (row.permission_type)
    lines.push(`type: ${yamlScalar(row.permission_type)}`);
  if (patterns.length > 0) {
    lines.push("patterns:");
    for (const p of patterns) lines.push(`  - ${yamlScalar(p)}`);
  }
  if (row.title) lines.push(`title: ${yamlScalar(row.title)}`);
  if (row.decision) lines.push(`decision: ${row.decision}`);
  lines.push(`auto: ${row.auto ? "true" : "false"}`);
  lines.push(`askedAt: ${row.asked_at}`);
  if (row.decided_at != null) lines.push(`decidedAt: ${row.decided_at}`);
  lines.push("```");
  return lines.join("\n");
}

export interface PermissionEventView {
  requestId: string;
  tool: string | null;
  type: string | null;
  patterns: string[];
  title: string | null;
  decision: PermissionDecisionValue | null;
  auto: boolean;
  askedAt: number;
  decidedAt: number | null;
}

export function permissionEventToView(
  row: PermissionEventRow,
): PermissionEventView {
  return {
    requestId: row.request_id,
    tool: row.tool_name,
    type: row.permission_type,
    patterns: parsePatterns(row.patterns),
    title: row.title,
    decision: row.decision,
    auto: row.auto === 1,
    askedAt: row.asked_at,
    decidedAt: row.decided_at,
  };
}

export function toSyntheticPermissionMessage(row: PermissionEventRow): unknown {
  const msgId = `permission::${row.id}`;
  return {
    info: {
      id: msgId,
      sessionID: row.session_id,
      role: "assistant",
      time: { created: row.asked_at, completed: row.decided_at ?? row.asked_at },
      _synthetic: true,
      _permissionEvent: permissionEventToView(row),
    },
    parts: [
      {
        id: `${msgId}::p0`,
        messageID: msgId,
        sessionID: row.session_id,
        type: "text",
        text: permissionEventToYaml(row),
      },
    ],
  };
}
