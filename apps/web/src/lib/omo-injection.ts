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

export interface OmoBlock {
  kind: "user" | "omo";
  text: string;
  header?: string;
  summary?: string;
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
    headerRegex: /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - CONTEXT WINDOW MONITOR\]/,
    extractSummary: (body) =>
      body.match(/\[Context Status: [^\]]+\]/)?.[0],
  },
  {
    headerRegex: /\[BACKGROUND TASK COMPLETED\]/,
    extractSummary: (body) =>
      body.match(/^\*+ID:\*+\s+`([^`]+)`/m)?.[1],
  },
];

const INITIATOR = "<!-- OMO_INTERNAL_INITIATOR -->";
const USER_TASK_REGEX = /<user-task>\s*([\s\S]*?)\s*<\/user-task>/g;
const AUTO_SLASH_REGEX = /<auto-slash-command>[\s\S]*?<\/auto-slash-command>/g;
const ULTRAWORK_REGEX = /<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/g;
const COMMAND_INSTR_REGEX = /<command-instruction>[\s\S]*?<\/command-instruction>/g;
const SYSTEM_REMINDER_REGEX =
  /<system-reminder>[\s\S]*?<\/system-reminder>(?:\s*<!-- OMO_INTERNAL_INITIATOR -->)?/g;
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
    const contentStart = wholeStart + m[0].indexOf(">", wholeStart - wholeStart) + 1;
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
      });
      cursor = end;
      continue;
    }
    const absStart = cursor + headerStart;
    const body = text.slice(absStart, end);
    out.push({
      start: absStart,
      end,
      header: headerLineAt(text, absStart),
      summary: findInjectionSummary(body),
      priority: 3,
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
  const slice = eol < 0 ? text.slice(headerStart) : text.slice(headerStart, eol);
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
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      header,
      summary: buildSummary(m[0]),
      priority,
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
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      header,
      summary: buildSummary(m[0]),
      priority: 2,
    });
  }
  return out;
}

function collectAllOmoRanges(text: string): Range[] {
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
    (body) => firstLine(body.replace(/^<command-instruction>\s*/, "").trim()).slice(0, 120),
    2,
  );
  const systemReminder = collectXmlRanges(
    text,
    SYSTEM_REMINDER_REGEX,
    "<system-reminder>",
    (body) =>
      body.match(/\[[A-Z][^\]\n]+\]/)?.[0] ??
      firstLine(body.replace(/^<system-reminder>\s*/, "").trim()).slice(0, 120),
    4,
  );
  const searchMode = collectLineRanges(
    text,
    SEARCH_MODE_REGEX,
    "[search-mode]",
    (body) =>
      body.match(/MAXIMIZE SEARCH EFFORT[^\n]*/)?.[0] ?? "(search-mode preamble)",
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
    (body) =>
      body.match(/^MANDATORY ([a-z_]+) params:/)?.[1] ?? undefined,
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
    ...initiator,
    ...ultrawork,
    ...autoSlash,
    ...commandInstr,
    ...systemReminder,
    ...searchMode,
    ...analyzeMode,
    ...mandatoryParams,
    ...catReminder,
    ...agentUsage,
  ].sort((a, b) => a.start - b.start);
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
            ? r.summary ?? last.summary
            : last.summary ?? r.summary,
        priority: Math.max(last.priority, r.priority),
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

export function parseOmoBlocks(text: string): OmoBlock[] {
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

  const rawOmo = collectAllOmoRanges(text);

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
      text: text.slice(r.start, r.end),
      header: r.header,
      summary: r.summary,
    });
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
    (ut) =>
      ut.start >= chunkStartAbs && ut.end <= chunkStartAbs + chunk.length,
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
