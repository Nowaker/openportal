import type { Part, ToolPart } from "@opencode-ai/sdk";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoSnapshot {
  todos: TodoItem[];
  updatedAt: number;
  toolPartId: string;
}

interface MessageLike {
  info?: { time?: { created?: number } };
  parts: Part[];
}

function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool";
}

function normaliseTodo(raw: unknown, idx: number): TodoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const content = typeof r.content === "string" ? r.content : "";
  if (!content) return null;
  const status =
    r.status === "in_progress" ||
    r.status === "completed" ||
    r.status === "cancelled" ||
    r.status === "pending"
      ? (r.status as TodoStatus)
      : "pending";
  const id = typeof r.id === "string" && r.id ? r.id : `${idx}-${content}`;
  return { id, content, status };
}

export function extractLatestTodos(
  messages: MessageLike[],
): TodoSnapshot | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || !Array.isArray(msg.parts)) continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (!isToolPart(part)) continue;
      if (part.tool !== "todowrite") continue;
      if (part.state.status !== "completed") continue;
      const meta = part.state.metadata;
      if (!meta || typeof meta !== "object") continue;
      const rawTodos = (meta as { todos?: unknown }).todos;
      if (!Array.isArray(rawTodos)) continue;
      const todos = rawTodos
        .map((t, idx) => normaliseTodo(t, idx))
        .filter((t): t is TodoItem => t !== null);
      if (todos.length === 0) continue;
      const updatedAt =
        part.state.time?.end ?? msg.info?.time?.created ?? Date.now();
      return {
        todos,
        updatedAt,
        toolPartId: part.id,
      };
    }
  }
  return null;
}
