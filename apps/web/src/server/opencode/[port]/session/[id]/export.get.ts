import { defineHandler, getQuery, setResponseHeader } from "nitro/h3";
import { fetchOpencode } from "../../../../lib/opencode-client";
import { parsePort, parseRouteParam } from "../../../../lib/validation";

// GET /api/opencode/:port/session/:id/export
//
// Render a session's chat history as a Markdown document for download.
// Query params:
//   ?kind=prompts | all     prompts = user messages only (default: all)
//   ?limit=N | all           cap on messages returned (default: all)
//   ?include-system=1        keep system reminders / OMO synthetic msgs
//                            (default: drop them - same filter dump-user-
//                             messages.ts uses by default)
//
// The Markdown shape mirrors `~/projekty/nowaker/opencode-tools/
// opencode-misc-scripts/dump-user-messages.ts`. Each turn becomes an
// `# YYYY-MM-DD HH:MM:SS UTC msg_<id>` H1 header followed by the
// text body. Tool calls + file parts are emitted as short
// `[tool: <name>]` / `[file: <filename>]` markers - the export is for
// readers; precise tool I/O can be inspected in the UI.

interface MessageInfo {
  id?: string;
  role?: string;
  time?: { created?: number };
  synthetic?: boolean;
  agent?: string;
  modelID?: string;
  providerID?: string;
}

interface MessagePart {
  type?: string;
  text?: string;
  filename?: string;
  tool?: string;
  ignored?: boolean;
  reasoning?: unknown;
}

interface Message {
  info?: MessageInfo;
  parts?: MessagePart[];
}

function fmtTime(ms: number | undefined): string {
  if (typeof ms !== "number") return "(unknown time)";
  const d = new Date(ms);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

interface PartFilters {
  includeThinking: boolean;
  includeTools: boolean;
}

function partsToMarkdown(parts: MessagePart[], filters: PartFilters): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (p.ignored) continue;
    if (p.type === "text" && typeof p.text === "string") {
      chunks.push(p.text);
    } else if (
      p.type === "reasoning" &&
      filters.includeThinking &&
      typeof p.text === "string"
    ) {
      chunks.push(`\n<details><summary>Thinking</summary>\n\n${p.text}\n\n</details>\n`);
    } else if (p.type === "file" && p.filename) {
      chunks.push(`\n[file: ${p.filename}]\n`);
    } else if (p.type === "tool" && filters.includeTools && p.tool) {
      chunks.push(`\n[tool: ${p.tool}]\n`);
    }
  }
  return chunks.join("").trim();
}

function isSyntheticOmo(msg: Message): boolean {
  if (msg.info?.synthetic === true) return true;
  const parts = msg.parts ?? [];
  if (parts.length === 1 && parts[0].ignored === true) return true;
  const txt = parts
    .filter((p): p is MessagePart & { text: string } => typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (
    txt.startsWith("[recovery-in-progress]") ||
    txt.startsWith("[recovery-compaction-succeeded]") ||
    txt.startsWith("[SYSTEM DIRECTIVE:")
  ) {
    return true;
  }
  return false;
}

function asBool(q: unknown, defaultValue: boolean): boolean {
  if (q === undefined) return defaultValue;
  const s = String(q);
  if (s === "1" || s === "true") return true;
  if (s === "0" || s === "false") return false;
  return defaultValue;
}

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const query = getQuery(event);

  const kind =
    query.kind === "prompts" || query.kind === "all"
      ? (query.kind as "prompts" | "all")
      : "all";
  const limitParam =
    typeof query.limit === "string"
      ? query.limit
      : typeof query.last === "string"
        ? query.last
        : "all";
  const limit =
    limitParam === "all" || limitParam === "0"
      ? null
      : Math.max(1, Math.min(10000, Number(limitParam) || 100));
  const includeSystem = asBool(query["include-system"], false);
  const format =
    query.format === "json" || query.format === "md"
      ? (query.format as "md" | "json")
      : "md";

  const usersFlag = asBool(query.users, kind !== "prompts");
  const aiAllFlag = asBool(query["ai-all"], kind === "all");
  const aiFinalFlag = asBool(query["ai-final"], kind === "all");
  const thinkingFlag = asBool(query.thinking, false);
  const toolsFlag = asBool(query.tools, kind === "all");

  const includeUsers = kind === "prompts" ? true : usersFlag;
  const includeAiAll = kind === "prompts" ? false : aiAllFlag;
  const includeAiFinal = kind === "prompts" ? false : aiFinalFlag;

  const upstreamLimit = limit ?? 5000;
  const res = await fetchOpencode(
    port,
    `/session/${encodeURIComponent(id)}/message?limit=${upstreamLimit}`,
  );
  if (!res.ok) {
    setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
    return `# Export failed\n\nopencode returned ${res.status} ${res.statusText}\n`;
  }
  const body = (await res.json().catch(() => null)) as unknown;
  const list: Message[] = Array.isArray(body) ? (body as Message[]) : [];

  let lastAssistantIdx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].info?.role === "assistant" && !isSyntheticOmo(list[i])) {
      lastAssistantIdx = i;
      break;
    }
  }
  const lastAssistantId =
    lastAssistantIdx >= 0 ? list[lastAssistantIdx].info?.id ?? null : null;

  const filtered = list.filter((m) => {
    if (!includeSystem && isSyntheticOmo(m)) return false;
    const role = m.info?.role;
    if (role === "user") return includeUsers;
    if (role === "assistant") {
      if (includeAiAll) return true;
      if (includeAiFinal && m.info?.id === lastAssistantId) return true;
      return false;
    }
    return true;
  });

  const sliced = limit !== null ? filtered.slice(-limit) : filtered;
  const partFilters: PartFilters = {
    includeThinking: thinkingFlag,
    includeTools: toolsFlag,
  };

  if (format === "json") {
    const payload = {
      sessionId: id,
      exportedAt: new Date().toISOString(),
      filters: {
        kind,
        limit,
        includeUsers,
        includeAiAll,
        includeAiFinal,
        includeThinking: thinkingFlag,
        includeTools: toolsFlag,
        includeSystem,
      },
      messages: sliced.map((m) => {
        const info = m.info ?? {};
        return {
          id: info.id,
          role: info.role,
          createdAt: info.time?.created
            ? new Date(info.time.created).toISOString()
            : null,
          providerID: info.providerID,
          modelID: info.modelID,
          agent: info.agent,
          parts: (m.parts ?? [])
            .filter((p) => !p.ignored)
            .filter((p) => p.type !== "reasoning" || thinkingFlag)
            .filter((p) => p.type !== "tool" || toolsFlag),
        };
      }),
    };
    setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
    setResponseHeader(
      event,
      "Content-Disposition",
      `attachment; filename="${id}-${kind}.json"`,
    );
    return payload;
  }

  const lines: string[] = [];
  lines.push(`# Session ${id}`);
  lines.push("");
  lines.push(`Exported ${fmtTime(Date.now())}`);
  lines.push(`Kind: ${kind === "prompts" ? "user prompts only" : "full conversation"}`);
  lines.push(`Messages: ${sliced.length}${limit ? ` (capped at ${limit})` : ""}`);
  lines.push("");
  for (const m of sliced) {
    const info = m.info ?? {};
    const time = fmtTime(info.time?.created);
    const role = info.role ?? "?";
    const tag =
      role === "assistant" && info.modelID
        ? ` (${info.providerID ?? "?"}/${info.modelID})`
        : "";
    lines.push(`## ${time} ${role}${tag} ${info.id ?? ""}`);
    lines.push("");
    const md = partsToMarkdown(m.parts ?? [], partFilters);
    lines.push(md.length > 0 ? md : "*(empty)*");
    lines.push("");
  }
  const markdown = lines.join("\n");

  setResponseHeader(event, "Content-Type", "text/markdown; charset=utf-8");
  setResponseHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${id}-${kind}.md"`,
  );
  return markdown;
});
