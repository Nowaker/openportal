export interface LiveMessageInfo {
  id: string;
  role?: string;
  finish?: string | null;
  error?: unknown;
}

export interface LiveMessagePart {
  type?: string;
  text?: string;
}

export interface LiveMessageShape {
  info: LiveMessageInfo;
  parts?: LiveMessagePart[];
}

export interface LiveRow {
  key: string;
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  type: string;
  text: string;
  isPlaceholder: boolean;
  role: "user" | "assistant" | "other";
  timestampMs: number;
}

export function shortenSessionTitle(title: string, maxLength = 32): string {
  const normalized = title.trim();
  if (normalized.length === 0) return "(untitled)";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`;
}

function assistantType(info: LiveMessageInfo): string {
  if (info.error != null) return "assistant:error";
  if (info.finish && info.finish !== "stop" && info.finish !== "tool-calls") {
    return "assistant:incomplete";
  }
  return "assistant";
}

export function classifyMessageType(info: LiveMessageInfo): string {
  if (info.role === "user") return "user";
  if (info.role === "assistant") return assistantType(info);
  if (info.role && info.role.length > 0) return info.role;
  return "unknown";
}

export function extractText(parts: LiveMessagePart[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text!.trim())
    .filter((chunk) => chunk.length > 0)
    .join("\n\n");
}

export function buildLiveRow(input: {
  sessionId: string;
  sessionTitle: string;
  message: LiveMessageShape;
  timestampMs: number;
}): LiveRow {
  const text = extractText(input.message.parts);
  const type = classifyMessageType(input.message.info);
  const role = input.message.info.role === "user"
    ? "user"
    : input.message.info.role === "assistant"
      ? "assistant"
      : "other";
  const isPlaceholder = text.length === 0;
  return {
    key: `${input.message.info.id}:${isPlaceholder ? "placeholder" : "text"}`,
    sessionId: input.sessionId,
    sessionTitle: shortenSessionTitle(input.sessionTitle, 32),
    messageId: input.message.info.id,
    type,
    text: isPlaceholder ? "(no text parts)" : text,
    isPlaceholder,
    role,
    timestampMs: input.timestampMs,
  };
}

export function reconcileRows(params: {
  rows: LiveRow[];
  seenByMessageId: Map<string, string>;
  incoming: LiveRow;
  maxRows?: number;
}): LiveRow[] {
  const maxRows = params.maxRows ?? 300;
  const existing = params.seenByMessageId.get(params.incoming.messageId);
  const incomingText = params.incoming.isPlaceholder ? "" : params.incoming.text;

  if (existing === undefined) {
    params.seenByMessageId.set(params.incoming.messageId, incomingText);
    return [...params.rows, params.incoming].slice(-maxRows);
  }

  if (existing === incomingText) {
    return params.rows;
  }

  params.seenByMessageId.set(params.incoming.messageId, incomingText);
  const next = [...params.rows, params.incoming];
  return next.slice(-maxRows);
}
