// Parses a raw user-message body into alternating user-text and OMO-
// injection blocks for the chat renderer. The renderer collapses each
// OMO block to a single line with an optional summary; user blocks
// render as normal markdown.
//
// The OhMyOpenCode plugin and several user-side conventions inject
// "directive" blocks into the prompt before opencode sees it. They
// render verbatim in chat as walls of text the user never typed:
//
//   - INITIATOR-terminated blocks: header ([SYSTEM DIRECTIVE: ...],
//     [BACKGROUND TASK COMPLETED], etc.) plus a trailing
//     <!-- OMO_INTERNAL_INITIATOR --> marker.
//   - XML-tag wrappers: <ultrawork-mode>, <auto-slash-command>,
//     <command-instruction>.
//   - <user-task> content nested inside <auto-slash-command>: this is
//     the user's actual ask wrapped by the slash machinery; the wrapper
//     is collapsed but the inner content is the message text.
//   - Line-based preambles: [search-mode] ... ---, [Category+Skill
//     Reminder], [Agent Usage Reminder].
//
// Adjacent OMO blocks (separated only by whitespace) consolidate into
// one collapsed block with the most informative headline available
// from any of the merged sources.

export interface OmoSegment {
  header: string;
  summary?: string;
}

export interface OmoBlock {
  kind: "user" | "omo";
  text: string;
  header?: string;
  summary?: string;
  // When multiple adjacent OMO triggers consolidate into one collapsed
  // wrapper (e.g. [search-mode]...[analyze-mode]...), this array lists
  // each contributing trigger's header+summary in source order so the
  // collapsed title can surface all of them, not just one.
  segments?: OmoSegment[];
  // Lazy-fetch reference for OMO bodies that the server stripped to
  // save bandwidth. When set, the renderer fetches the full text on
  // expand via /api/opencode/{port}/session/{id}/message/{msgId}/omo/{ref.blockId}
  // instead of reading `text` (which is empty for stripped blocks).
  ref?: { blockId: string; bytes: number };
}

export interface OmoParseOptions {
  directoryContextResolver?: (path: string) => string | null | undefined;
}

interface ExtractedUserMessage {
  wrapperText: string;
  userText: string;
  summary: string;
}

interface InitiatorCatcher {
  headerRegex: RegExp;
  extractSummary?: (body: string) => string | undefined;
}

const INITIATOR_CATCHERS: InitiatorCatcher[] = [
  {
    headerRegex: /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION\]/,
    extractSummary: (body) =>
      body.match(/\[Status: \d+\/\d+ completed, \d+ remaining\]/)?.[0],
  },
  {
    headerRegex:
      /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - CONTEXT WINDOW MONITOR\]/,
    extractSummary: (body) => body.match(/\[Context Status: [^\]]+\]/)?.[0],
  },
  {
    headerRegex: /\[BACKGROUND TASK COMPLETED\]/,
    extractSummary: (body) => body.match(/^\*+ID:\*+\s+`([^`]+)`/m)?.[1],
  },
];

const INITIATOR = "<!-- OMO_INTERNAL_INITIATOR -->";
const STRIPPED_MARKER_REGEX = /<!--OMO-STRIPPED:([^>]+)-->/g;
const USER_TASK_REGEX = /<user-task>\s*([\s\S]*?)\s*<\/user-task>/g;
const AUTO_SLASH_REGEX = /<auto-slash-command>[\s\S]*?<\/auto-slash-command>/g;
const ULTRAWORK_REGEX = /<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/g;
const COMMAND_INSTR_REGEX =
  /<command-instruction>[\s\S]*?<\/command-instruction>/g;
const ORPHAN_SYSTEM_REMINDER_TAIL_REGEX =
  /\n+\s*Please address this message and continue with your tasks\.\s*<\/system-reminder>/g;
const SEARCH_MODE_REGEX =
  /^\[search-mode\][\s\S]*?(?:\n---(?:\n|$)|$(?![\s\S]))/gm;
const ANALYZE_MODE_REGEX =
  /^\[analyze-mode\][\s\S]*?(?:\n---(?:\n|$)|$(?![\s\S]))/gm;
const MANDATORY_PARAMS_REGEX =
  /^MANDATORY [a-z_]+ params:[\s\S]*?(?:\n---(?:\n|$)|$(?![\s\S]))/gm;
const CATEGORY_REMINDER_REGEX =
  /^\[Category\+Skill Reminder\][\s\S]*?(?=\n\n[^\s\[<]|$)/gm;
const AGENT_USAGE_REMINDER_REGEX =
  /^\[Agent Usage Reminder\][\s\S]*?(?=\n\n[^\s\[<]|$)/gm;
const DIRECTORY_CONTEXT_HEADER_REGEX =
  /^\[Directory Context:\s*([^\]\n]+)\]\r?\n/gm;

function firstLine(s: string): string {
  return s.split("\n", 1)[0] ?? "";
}

function findInjectionSummary(body: string): string | undefined {
  for (const c of INITIATOR_CATCHERS) {
    if (c.headerRegex.test(body)) {
      return c.extractSummary?.(body);
    }
  }
  return undefined;
}

interface Range {
  start: number;
  end: number;
  header: string;
  summary: string | undefined;
  // higher priority wins when consolidated ranges contribute multiple
  // candidate headers (e.g. an <ultrawork-mode> block plus an adjacent
  // <auto-slash-command>; ultrawork's "ENABLED!" banner wins).
  priority: number;
  // Source-order list of (header, summary) pairs that contributed to
  // this range. Single-trigger ranges have one entry; consolidateAdjacent
  // concatenates the lists when it merges adjacent ranges.
  segments: OmoSegment[];
  // Server-stripped OMO bodies carry a lazy-fetch reference instead of
  // inline text. The renderer pulls the full body from the dedicated
  // /omo/{blockId} endpoint on expand.
  ref?: { blockId: string; bytes: number };
  exposedText?: string;
  textOverride?: string;
}

interface UserTaskRange {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
}

function collectUserTaskRanges(text: string): UserTaskRange[] {
  const out: UserTaskRange[] = [];
  for (const m of text.matchAll(USER_TASK_REGEX)) {
    if (m.index === undefined) continue;
    const wholeStart = m.index;
    const wholeEnd = wholeStart + m[0].length;
    const contentStart =
      wholeStart + m[0].indexOf(">", wholeStart - wholeStart) + 1;
    const realContentStart = wholeStart + "<user-task>".length;
    const realContentEnd = wholeEnd - "</user-task>".length;
    out.push({
      start: wholeStart,
      end: wholeEnd,
      contentStart: realContentStart,
      contentEnd: realContentEnd,
    });
    void contentStart;
  }
  return out;
}

function collectInitiatorRanges(text: string): Range[] {
  const out: Range[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const initiatorIdx = text.indexOf(INITIATOR, cursor);
    if (initiatorIdx < 0) break;
    const segment = text.slice(cursor, initiatorIdx);
    const headerStart = findLastInjectionHeaderOffset(segment);
    const end = initiatorIdx + INITIATOR.length;
    if (headerStart === -1) {
      out.push({
        start: cursor,
        end,
        header: "OMO directive",
        summary: undefined,
        priority: 1,
        segments: [{ header: "OMO directive", summary: undefined }],
      });
      cursor = end;
      continue;
    }
    const absStart = cursor + headerStart;
    const body = text.slice(absStart, end);
    const header = headerLineAt(text, absStart);
    const summary = findInjectionSummary(body);
    out.push({
      start: absStart,
      end,
      header,
      summary,
      priority: 3,
      segments: [{ header, summary }],
    });
    cursor = end;
  }
  return out;
}

// Find the LAST bracketed-header offset inside a segment that ends
// just before an OMO_INTERNAL_INITIATOR. Iterates with matchAll() and
// keeps the final match - the OMO header is closest to the marker, so
// stray earlier brackets (markdown citations, checklists) won't swallow
// legitimate user text.
function findLastInjectionHeaderOffset(segment: string): number {
  const passes: RegExp[] = [
    /(?:^|\n)\[SYSTEM DIRECTIVE:[^\]\n]+\]/g,
    /\[SYSTEM DIRECTIVE:[^\]\n]+\]/g,
    /(?:^|\n)\[[^\]\n]+\][^\n]*/g,
  ];
  for (const re of passes) {
    re.lastIndex = 0;
    let last: { index: number; match: string } | null = null;
    for (const m of segment.matchAll(re)) {
      if (m.index === undefined) continue;
      last = { index: m.index, match: m[0] };
    }
    if (last) {
      const offsetInMatch = last.match.startsWith("\n") ? 1 : 0;
      return last.index + offsetInMatch;
    }
  }
  return -1;
}

function headerLineAt(text: string, headerStart: number): string {
  const eol = text.indexOf("\n", headerStart);
  const slice =
    eol < 0 ? text.slice(headerStart) : text.slice(headerStart, eol);
  return slice;
}

function collectXmlRanges(
  text: string,
  re: RegExp,
  header: string,
  buildSummary: (body: string) => string | undefined,
  priority: number,
): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    const summary = buildSummary(m[0]);
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      header,
      summary,
      priority,
      segments: [{ header, summary }],
    });
  }
  return out;
}

function collectLineRanges(
  text: string,
  re: RegExp,
  header: string,
  buildSummary: (body: string) => string | undefined,
): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    const summary = buildSummary(m[0]);
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      header,
      summary,
      priority: 2,
      segments: [{ header, summary }],
    });
  }
  return out;
}

function collectStrippedMarkerRanges(text: string): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(STRIPPED_MARKER_REGEX)) {
    if (m.index === undefined) continue;
    let meta: {
      id?: string;
      header?: string;
      summary?: string;
      bytes?: number;
      segments?: OmoSegment[];
    } = {};
    try {
      meta = JSON.parse(decodeURIComponent(m[1] ?? ""));
    } catch {
      continue;
    }
    const blockId = typeof meta.id === "string" ? meta.id : "";
    if (!blockId) continue;
    const header = meta.header || "OMO directive";
    const summary = meta.summary || undefined;
    const segments =
      Array.isArray(meta.segments) && meta.segments.length > 0
        ? meta.segments
            .filter((s) => s && typeof (s as OmoSegment).header === "string")
            .map((s) => ({
              header: (s as OmoSegment).header,
              summary: (s as OmoSegment).summary,
            }))
        : [{ header, summary }];
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      header,
      summary,
      priority: 10,
      segments,
      ref: { blockId, bytes: typeof meta.bytes === "number" ? meta.bytes : 0 },
    });
  }
  return out;
}

function collectOrphanSystemReminderTailRanges(text: string): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(ORPHAN_SYSTEM_REMINDER_TAIL_REGEX)) {
    if (m.index === undefined) continue;
    const summary = "Please address this message and continue with your tasks.";
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      header: "<system-reminder>",
      summary,
      priority: 1,
      segments: [{ header: "<system-reminder>", summary }],
    });
  }
  return out;
}

function collectDirectoryContextRanges(
  text: string,
  resolver: OmoParseOptions["directoryContextResolver"],
): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(DIRECTORY_CONTEXT_HEADER_REGEX)) {
    if (m.index === undefined) continue;
    const path = (m[1] ?? "").trim();
    if (!path) continue;
    const contentStart = m.index + m[0].length;
    const exactEnd = findExactDirectoryContextEnd(
      text,
      contentStart,
      resolver?.(path) ?? null,
    );
    const end = exactEnd ?? findFirstFenceLineEnd(text, contentStart);
    if (end === null || end <= contentStart) continue;
    const summary = path;
    out.push({
      start: m.index,
      end,
      header: "[Directory Context]",
      summary,
      priority: 5,
      segments: [{ header: "[Directory Context]", summary }],
    });
  }
  return out;
}

function findExactDirectoryContextEnd(
  text: string,
  contentStart: number,
  source: string | null,
): number | null {
  if (!source || !text.startsWith(source, contentStart)) return null;
  const afterSource = contentStart + source.length;
  const rest = text.slice(afterSource);
  const fence = rest.match(/^(?:\r?\n)*[ \t]*---[ \t]*(?:\r?\n|$)/);
  return afterSource + (fence ? fence[0].length : 0);
}

function findFirstFenceLineEnd(text: string, start: number): number | null {
  const fence = /^[ \t]*---[ \t]*(?:\r?\n|$)/gm;
  fence.lastIndex = start;
  const m = fence.exec(text);
  return m ? m.index + m[0].length : null;
}

function collectAllOmoRanges(text: string, options: OmoParseOptions): Range[] {
  const stripped = collectStrippedMarkerRanges(text);
  const directoryContext = collectDirectoryContextRanges(
    text,
    options.directoryContextResolver,
  );
  const initiator = collectInitiatorRanges(text);
  const ultrawork = collectXmlRanges(
    text,
    ULTRAWORK_REGEX,
    "<ultrawork-mode>",
    (body) =>
      body.match(/ULTRAWORK MODE ENABLED!/)?.[0] ??
      body.match(/\[CODE RED\][^\n]*/)?.[0] ??
      undefined,
    4,
  );
  const autoSlash = collectXmlRanges(
    text,
    AUTO_SLASH_REGEX,
    "<auto-slash-command>",
    (body) => {
      const cmd = body.match(/#\s*\/(\S+)\s+Command/i)?.[1];
      return cmd ? `/${cmd}` : undefined;
    },
    3,
  );
  const commandInstr = collectXmlRanges(
    text,
    COMMAND_INSTR_REGEX,
    "<command-instruction>",
    (body) =>
      firstLine(body.replace(/^<command-instruction>\s*/, "").trim()).slice(
        0,
        120,
      ),
    2,
  );
  const systemReminder = collectSystemReminderRanges(text);
  const orphanSystemReminderTail = collectOrphanSystemReminderTailRanges(text);
  const searchMode = collectLineRanges(
    text,
    SEARCH_MODE_REGEX,
    "[search-mode]",
    (body) =>
      body.match(/MAXIMIZE SEARCH EFFORT[^\n]*/)?.[0] ??
      "(search-mode preamble)",
  );
  const analyzeMode = collectLineRanges(
    text,
    ANALYZE_MODE_REGEX,
    "[analyze-mode]",
    (body) =>
      body.match(/ANALYSIS MODE[^\n]*/)?.[0] ?? "(analyze-mode preamble)",
  );
  const mandatoryParams = collectLineRanges(
    text,
    MANDATORY_PARAMS_REGEX,
    "MANDATORY params",
    (body) => body.match(/^MANDATORY ([a-z_]+) params:/)?.[1] ?? undefined,
  );
  const catReminder = collectLineRanges(
    text,
    CATEGORY_REMINDER_REGEX,
    "[Category+Skill Reminder]",
    () => undefined,
  );
  const agentUsage = collectLineRanges(
    text,
    AGENT_USAGE_REMINDER_REGEX,
    "[Agent Usage Reminder]",
    () => undefined,
  );

  return [
    ...stripped,
    ...directoryContext,
    ...initiator,
    ...ultrawork,
    ...autoSlash,
    ...commandInstr,
    ...systemReminder,
    ...orphanSystemReminderTail,
    ...searchMode,
    ...analyzeMode,
    ...mandatoryParams,
    ...catReminder,
    ...agentUsage,
  ].sort((a, b) => a.start - b.start);
}

function collectSystemReminderRanges(text: string): Range[] {
  const out: Range[] = [];
  const openTag = "<system-reminder>";
  const closeTag = "</system-reminder>";
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(openTag, cursor);
    if (start < 0) break;

    let depth = 1;
    let scan = start + openTag.length;
    let coreEnd = -1;

    while (depth > 0) {
      const nextOpen = text.indexOf(openTag, scan);
      const nextClose = text.indexOf(closeTag, scan);
      if (nextClose < 0) break;

      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        scan = nextOpen + openTag.length;
        continue;
      }

      depth -= 1;
      scan = nextClose + closeTag.length;
      if (depth === 0) {
        coreEnd = scan;
      }
    }

    if (coreEnd < 0) {
      cursor = start + openTag.length;
      continue;
    }

    let end = coreEnd;
    const trailing = text.slice(end);
    const initiatorMatch = trailing.match(
      /^\s*<!-- OMO_INTERNAL_INITIATOR -->/,
    );
    if (initiatorMatch) {
      end += initiatorMatch[0].length;
    }

    const coreBody = text.slice(start, coreEnd);
    const fullBody = text.slice(start, end);
    const extracted = extractUserMessageFromSystemReminder(coreBody);
    const blockText = extracted
      ? extracted.wrapperText + text.slice(coreEnd, end)
      : fullBody;
    const summary =
      extracted?.summary ??
      blockText.match(/\[[A-Z][^\]\n]+\]/)?.[0] ??
      firstLine(blockText.replace(/^<system-reminder>\s*/, "").trim()).slice(
        0,
        120,
      );

    out.push({
      start,
      end,
      header: "<system-reminder>",
      summary,
      priority: 4,
      segments: [{ header: "<system-reminder>", summary }],
      exposedText: extracted?.userText,
      textOverride: extracted ? blockText : undefined,
    });

    cursor = end;
  }

  return out;
}

function extractUserMessageFromSystemReminder(
  coreBody: string,
): ExtractedUserMessage | undefined {
  const openTag = "<system-reminder>";
  const closeTag = "</system-reminder>";
  if (!coreBody.startsWith(openTag) || !coreBody.endsWith(closeTag)) {
    return undefined;
  }

  const inner = coreBody.slice(openTag.length, -closeTag.length);
  const match = inner.match(
    /^(\s*)The user sent the following message:\s*\n([\s\S]*?)\n\s*\n(Please address this message and continue with your tasks\.)\s*$/,
  );
  if (!match) return undefined;

  const leading = match[1] ?? "";
  const userText = match[2] ?? "";
  const summary =
    match[3] ?? "Please address this message and continue with your tasks.";
  if (!userText.trim() || isStandaloneOmoPayload(userText)) {
    return undefined;
  }

  return {
    wrapperText: `${openTag}${leading}The user sent the following message:\n\n${summary}\n${closeTag}`,
    userText,
    summary,
  };
}

function isStandaloneOmoPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<system-reminder>")) return false;
  const ranges = collectSystemReminderRanges(trimmed);
  if (ranges.length !== 1) return false;
  return ranges[0]!.start === 0 && ranges[0]!.end === trimmed.length;
}

function collectFencedCodeBlockRanges(
  text: string,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const fenceRegex = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/gm;
  let open: { start: number; marker: string } | null = null;
  for (const m of text.matchAll(fenceRegex)) {
    if (m.index === undefined) continue;
    const marker = (m[1] ?? "").slice(0, 1).repeat(3);
    if (!open) {
      open = { start: m.index, marker };
      continue;
    }
    if ((m[1] ?? "").startsWith(open.marker)) {
      out.push({ start: open.start, end: m.index + m[0].length });
      open = null;
    }
  }
  if (open) out.push({ start: open.start, end: text.length });
  return out;
}

function dedupeOverlapping(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) continue;
    out.push(r);
  }
  return out;
}

// Subtract user-task content ranges from an OMO range; the result is
// 0, 1, or 2 OMO sub-ranges sandwiching the user-task content. Used
// when an OMO wrapper (<auto-slash-command>) contains the user's
// actual ask wrapped in <user-task>...</user-task>.
function splitRangeAroundUserTask(
  range: Range,
  userTasks: UserTaskRange[],
): Range[] {
  const inside = userTasks.filter(
    (ut) => ut.start >= range.start && ut.end <= range.end,
  );
  if (inside.length === 0) return [range];
  const out: Range[] = [];
  let cur = range.start;
  for (const ut of inside) {
    if (ut.start > cur) {
      out.push({
        start: cur,
        end: ut.start,
        header: range.header,
        summary: range.summary,
        priority: range.priority,
        segments: range.segments,
        ref: range.ref,
      });
    }
    cur = ut.end;
  }
  if (cur < range.end) {
    out.push({
      start: cur,
      end: range.end,
      header: range.header,
      summary: range.summary,
      priority: range.priority,
      segments: range.segments,
      ref: range.ref,
    });
  }
  return out;
}

function consolidateAdjacent(ranges: Range[], text: string): Range[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && isOnlyWhitespace(text.slice(last.end, r.start))) {
      const merged: Range = {
        start: last.start,
        end: r.end,
        header: r.priority > last.priority ? r.header : last.header,
        summary:
          r.priority > last.priority
            ? (r.summary ?? last.summary)
            : (last.summary ?? r.summary),
        priority: Math.max(last.priority, r.priority),
        segments: [...last.segments, ...r.segments],
        ref: last.ref ?? r.ref,
      };
      out[out.length - 1] = merged;
    } else {
      out.push(r);
    }
  }
  return out;
}

function isOnlyWhitespace(s: string): boolean {
  return /^[\s-]*$/.test(s);
}

// Drops OMO directive blocks, keeping only user-authored text. Two
// non-obvious invariants: when no OMO block is present the result equals
// the input verbatim (so normal messages copy unchanged - only the
// seam left by a removed OMO block gets newline-normalized + trimmed);
// and template wrappers are NOT this function's job - the caller strips
// them before parseOmoBlocks runs and re-appends them verbatim after.
export function userTextFromOmoBlocks(blocks: OmoBlock[]): string {
  const hasOmo = blocks.some((b) => b.kind === "omo");
  const userText = blocks
    .filter((b) => b.kind === "user")
    .map((b) => b.text)
    .join("");
  if (!hasOmo) return userText;
  return userText.replace(/\n{3,}/g, "\n\n").trim();
}

export function parseOmoBlocks(
  text: string,
  options: OmoParseOptions = {},
): OmoBlock[] {
  if (!text) return [{ kind: "user", text }];

  const allUserTasks: UserTaskRange[] = [];
  for (const m of text.matchAll(USER_TASK_REGEX)) {
    if (m.index === undefined) continue;
    allUserTasks.push({
      start: m.index,
      end: m.index + m[0].length,
      contentStart: m.index + "<user-task>".length,
      contentEnd: m.index + m[0].length - "</user-task>".length,
    });
  }

  const codeBlockRanges = collectFencedCodeBlockRanges(text);
  const rawOmo = collectAllOmoRanges(text, options).filter(
    (r) =>
      !codeBlockRanges.some((cr) => r.start >= cr.start && r.end <= cr.end),
  );

  // <user-task> instances INSIDE another OMO wrapper (e.g. inside
  // <auto-slash-command>) stay collapsed with their wrapper. Only the
  // OUTER / sibling <user-task> blocks render as user prose. This
  // matches opencode's slash machinery: the slash wrapper repeats the
  // user text inside itself for the LLM, then echoes it once more as
  // a top-level <user-task> sibling - the latter is what we want to
  // show to the user.
  const userTasks = allUserTasks.filter(
    (ut) => !rawOmo.some((r) => ut.start >= r.start && ut.end <= r.end),
  );

  const splitOmo = rawOmo.flatMap((r) =>
    splitRangeAroundUserTask(r, userTasks),
  );
  const deduped = dedupeOverlapping(splitOmo);
  const consolidated = consolidateAdjacent(deduped, text);

  if (consolidated.length === 0) {
    return [{ kind: "user", text }];
  }

  const blocks: OmoBlock[] = [];
  let cursor = 0;
  for (const r of consolidated) {
    if (r.start > cursor) {
      const userChunk = text.slice(cursor, r.start);
      const projected = userTaskContentOnly(userChunk, cursor, userTasks);
      blocks.push({ kind: "user", text: projected });
    }
    blocks.push({
      kind: "omo",
      text: r.ref ? "" : (r.textOverride ?? text.slice(r.start, r.end)),
      header: r.header,
      summary: r.summary,
      segments: r.segments,
      ref: r.ref,
    });
    if (r.exposedText) {
      blocks.push({ kind: "user", text: r.exposedText });
    }
    cursor = r.end;
  }
  if (cursor < text.length) {
    const userChunk = text.slice(cursor);
    const projected = userTaskContentOnly(userChunk, cursor, userTasks);
    blocks.push({ kind: "user", text: projected });
  }

  return blocks;
}

// Inside a user-text chunk, the only <user-task>...</user-task> ranges
// that survived range-splitting (i.e. weren't inside an OMO wrapper)
// should render as their INNER CONTENT, not their literal tags. Strip
// the tags and return just the content text. Outside any user-task,
// the chunk is returned verbatim.
function userTaskContentOnly(
  chunk: string,
  chunkStartAbs: number,
  userTasks: UserTaskRange[],
): string {
  const relevant = userTasks.filter(
    (ut) => ut.start >= chunkStartAbs && ut.end <= chunkStartAbs + chunk.length,
  );
  if (relevant.length === 0) return chunk;
  let out = "";
  let cur = 0;
  for (const ut of relevant) {
    const localStart = ut.start - chunkStartAbs;
    const localEnd = ut.end - chunkStartAbs;
    const localContentStart = ut.contentStart - chunkStartAbs;
    const localContentEnd = ut.contentEnd - chunkStartAbs;
    out += chunk.slice(cur, localStart);
    out += chunk.slice(localContentStart, localContentEnd);
    cur = localEnd;
  }
  out += chunk.slice(cur);
  return out;
}
