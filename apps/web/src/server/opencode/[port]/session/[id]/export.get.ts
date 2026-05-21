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

function partsToMarkdown(parts: MessagePart[]): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (p.ignored) continue;
    if (p.type === "text" && typeof p.text === "string") {
      chunks.push(p.text);
    } else if (p.type === "file" && p.filename) {
      chunks.push(`\n[file: ${p.filename}]\n`);
    } else if (p.type === "tool" && p.tool) {
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

export default defineHandler(async (event) => {
  const port = parsePort(event);
  const id = parseRouteParam(event, "id");
  const query = getQuery(event);

  const kind =
    query.kind === "prompts" || query.kind === "all"
      ? (query.kind as "prompts" | "all")
      : "all";
  const limitParam =
    typeof query.limit === "string" ? query.limit : "all";
  const limit =
    limitParam === "all" || limitParam === "0"
      ? null
      : Math.max(1, Math.min(10000, Number(limitParam) || 100));
  const includeSystem =
    query["include-system"] === "1" || query["include-system"] === "true";

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

  const filtered = list.filter((m) => {
    if (!includeSystem && isSyntheticOmo(m)) return false;
    if (kind === "prompts" && m.info?.role !== "user") return false;
    return true;
  });

  const sliced = limit !== null ? filtered.slice(-limit) : filtered;

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
    const md = partsToMarkdown(m.parts ?? []);
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
