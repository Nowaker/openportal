// The OhMyOpenCode plugin injects "directive" blocks into the user's
// prompt before opencode sees it (todo-continuation, context-monitor,
// search-mode, agent-usage reminders, slash-command wrappers, etc.).
// They render verbatim in the chat as huge walls of text that the user
// never actually typed and doesn't want to re-read on every scroll.
//
// parseOmoBlocks() splits a raw user-message body into alternating
// user-typed chunks and OMO-injection chunks so the renderer can collapse
// the injection chunks to a single line + summary.
//
// Detection strategy:
//   1. Find every <!-- OMO_INTERNAL_INITIATOR --> marker - that's the
//      structural terminator the plugin emits at the end of each
//      injected block.
//   2. For each marker, walk back to the most recent bracketed [...]
//      header at column 0 inside the unconsumed segment. The injection
//      spans header -> marker (inclusive).
//   3. Anything outside an injection range is user-typed prose.
//   4. <auto-slash-command>...</auto-slash-command> blocks are detected
//      separately - they wrap user slash invocations and don't use the
//      OMO_INTERNAL_INITIATOR marker.
//
// Catchers per known trigger pull a useful one-line summary out of the
// injection body so the collapsed view exposes the relevant metadata
// (todo-continuation surfaces Status, context-monitor surfaces Context
// Status, slash-command surfaces the user-task line). Unknown triggers
// collapse to header-only.

export interface OmoBlock {
  kind: "user" | "omo";
  text: string;
  header?: string;
  summary?: string;
}

interface Catcher {
  headerRegex: RegExp;
  extractSummary?: (body: string) => string | undefined;
}

const CATCHERS: Catcher[] = [
  {
    headerRegex: /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION\]/,
    extractSummary: (body) =>
      body.match(/\[Status: \d+\/\d+ completed, \d+ remaining\]/)?.[0],
  },
  {
    headerRegex: /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - CONTEXT WINDOW MONITOR\]/,
    extractSummary: (body) =>
      body.match(/\[Context Status: [^\]]+\]/)?.[0],
  },
  {
    headerRegex: /\[BACKGROUND TASK COMPLETED\]/,
    extractSummary: (body) =>
      body.match(/^[*]+ID:[*]+\s+`([^`]+)`/m)?.[1],
  },
];

const INITIATOR = "<!-- OMO_INTERNAL_INITIATOR -->";
const AUTO_SLASH = /<auto-slash-command>[\s\S]*?<\/auto-slash-command>/g;

function firstLine(s: string): string {
  return s.split("\n", 1)[0] ?? "";
}

function findInjectionSummary(body: string): string | undefined {
  for (const c of CATCHERS) {
    if (c.headerRegex.test(body)) {
      return c.extractSummary?.(body);
    }
  }
  return undefined;
}

function parseAutoSlashBlocks(text: string): OmoBlock[] {
  const blocks: OmoBlock[] = [];
  AUTO_SLASH.lastIndex = 0;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = AUTO_SLASH.exec(text)) !== null) {
    if (m.index > pos) {
      blocks.push({ kind: "user", text: text.slice(pos, m.index) });
    }
    const body = m[0];
    const cmdName = body.match(/#\s*\/(\S+)\s+Command/i)?.[1];
    const userTask = body
      .match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/)?.[1]
      ?.trim();
    const summary = userTask ? firstLine(userTask).slice(0, 120) : undefined;
    blocks.push({
      kind: "omo",
      text: body,
      header: cmdName ? `/${cmdName}` : "slash command",
      summary,
    });
    pos = m.index + body.length;
  }
  if (pos < text.length) blocks.push({ kind: "user", text: text.slice(pos) });
  return blocks;
}

export function parseOmoBlocks(text: string): OmoBlock[] {
  const hasInitiator = text.includes(INITIATOR);
  const hasAutoSlash = AUTO_SLASH.test(text);
  if (!hasInitiator && !hasAutoSlash) {
    return [{ kind: "user", text }];
  }
  if (!hasInitiator) {
    return parseAutoSlashBlocks(text);
  }

  const blocks: OmoBlock[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const initiatorIdx = text.indexOf(INITIATOR, cursor);
    if (initiatorIdx < 0) {
      blocks.push({ kind: "user", text: text.slice(cursor) });
      break;
    }
    const segment = text.slice(cursor, initiatorIdx);
    const headerMatch = segment.match(/^\[[^\]\n]+\][^\n]*/m);
    if (!headerMatch) {
      if (segment.length > 0) {
        blocks.push({ kind: "user", text: segment });
      }
      cursor = initiatorIdx + INITIATOR.length;
      continue;
    }
    const headerOffset = headerMatch.index ?? 0;
    const headerStart = cursor + headerOffset;
    if (headerStart > cursor) {
      blocks.push({ kind: "user", text: text.slice(cursor, headerStart) });
    }
    const injectionText = text.slice(
      headerStart,
      initiatorIdx + INITIATOR.length,
    );
    blocks.push({
      kind: "omo",
      text: injectionText,
      header: headerMatch[0],
      summary: findInjectionSummary(injectionText),
    });
    cursor = initiatorIdx + INITIATOR.length;
  }

  return blocks.flatMap((b) =>
    b.kind === "user" && AUTO_SLASH.test(b.text) ? parseAutoSlashBlocks(b.text) : [b],
  );
}
