// The OhMyOpenCode plugin and several user-side conventions inject
// "directive" blocks into the prompt before opencode sees it: todo-
// continuation, context-window monitor, search-mode preambles,
// ultrawork-mode / ralph-loop boilerplate, slash-command wrappers,
// auto-injected agent-usage reminders, background-task-completion
// notifications, and so on. They render verbatim in chat as walls of
// text the user never typed and does not want to re-read on every
// scroll.
//
// parseOmoBlocks() splits a raw user-message body into alternating
// user-typed chunks and OMO-injection chunks so the renderer can
// collapse the injection chunks to a single line + extracted summary.
//
// Three families of detectable injections:
//
//   1. INITIATOR-terminated blocks. Start with a bracketed [...] header
//      at column 0 and end with the <!-- OMO_INTERNAL_INITIATOR -->
//      marker. Catches the plugin's directive class: TODO CONTINUATION,
//      CONTEXT WINDOW MONITOR, BACKGROUND TASK COMPLETED, etc.
//
//   2. XML-tag wrappers. <tag>...</tag> blocks: <auto-slash-command>,
//      <ultrawork-mode>, <command-instruction>. Caught as one collapsed
//      block each. (<user-task> is intentionally NOT caught - that's
//      the user's actual ask wrapped by the slash machinery.)
//
//   3. Line-based preambles. Open with a known bracketed tag on its
//      own line ([search-mode], [ultrabrain], [deep], [artistry],
//      [Category+Skill Reminder], [Agent Usage Reminder]) and stretch
//      until a '---' separator line OR end-of-message. The user's
//      convention: directive header + body + --- separator + actual
//      prompt.
//
// Catchers per family extract a useful one-line summary so the
// collapsed view still surfaces the actionable metadata (todo-
// continuation surfaces Status, ultrawork-mode surfaces the wake-up
// banner, slash-command surfaces the user-task line). Unknown triggers
// collapse to header-only.

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

interface NonInitiatorPattern {
  regex: RegExp;
  buildHeader: (match: string) => string;
  buildSummary?: (match: string) => string | undefined;
}

const NON_INITIATOR_PATTERNS: NonInitiatorPattern[] = [
  {
    regex: /<auto-slash-command>[\s\S]*?<\/auto-slash-command>/g,
    buildHeader: (body) => {
      const m = body.match(/#\s*\/(\S+)\s+Command/i);
      return m ? `/${m[1]} (slash command)` : "<auto-slash-command>";
    },
    buildSummary: (body) => {
      const task = body
        .match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/)?.[1]
        ?.trim();
      return task ? firstLine(task).slice(0, 120) : undefined;
    },
  },
  {
    regex: /<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/g,
    buildHeader: () => "<ultrawork-mode>",
    buildSummary: (body) => {
      const banner = body.match(/ULTRAWORK MODE ENABLED!/)?.[0];
      if (banner) return banner;
      return body.match(/\[CODE RED\][^\n]*/)?.[0];
    },
  },
  {
    regex: /<command-instruction>[\s\S]*?<\/command-instruction>/g,
    buildHeader: () => "<command-instruction>",
    buildSummary: (body) => firstLine(body.replace(/^<command-instruction>\s*/, "").trim()).slice(0, 120),
  },
  {
    regex: /^\[search-mode\][\s\S]*?(?:\n---(?:\n|$)|$(?![\s\S]))/gm,
    buildHeader: () => "[search-mode]",
    buildSummary: (body) =>
      body.match(/MAXIMIZE SEARCH EFFORT[^\n]*/)?.[0] ?? "(search-mode preamble)",
  },
  {
    regex: /^\[Category\+Skill Reminder\][\s\S]*?(?=\n\n[^\s\[<]|$)/gm,
    buildHeader: () => "[Category+Skill Reminder]",
  },
  {
    regex: /^\[Agent Usage Reminder\][\s\S]*?(?=\n\n[^\s\[<]|$)/gm,
    buildHeader: () => "[Agent Usage Reminder]",
  },
];

const INITIATOR = "<!-- OMO_INTERNAL_INITIATOR -->";

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
}

function collectNonInitiatorRanges(text: string): Range[] {
  const ranges: Range[] = [];
  for (const pat of NON_INITIATOR_PATTERNS) {
    pat.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.regex.exec(text)) !== null) {
      const body = m[0];
      ranges.push({
        start: m.index,
        end: m.index + body.length,
        header: pat.buildHeader(body),
        summary: pat.buildSummary?.(body),
      });
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function collectInitiatorRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const initiatorIdx = text.indexOf(INITIATOR, cursor);
    if (initiatorIdx < 0) break;
    const segment = text.slice(cursor, initiatorIdx);
    const headerOffset = findInjectionHeaderOffset(segment);
    if (headerOffset === -1) {
      const start = cursor;
      const end = initiatorIdx + INITIATOR.length;
      ranges.push({
        start,
        end,
        header: "OMO directive",
        summary: undefined,
      });
      cursor = end;
      continue;
    }
    const headerStart = cursor + headerOffset;
    if (headerStart > cursor) {
      // Leave the user-typed prefix to the user side by starting the
      // range at the header. The mergeAndDedupe pass keeps the prefix
      // segment as a 'user' block.
    }
    const end = initiatorIdx + INITIATOR.length;
    const body = text.slice(headerStart, end);
    const headerLine = headerLineAt(text, headerStart);
    ranges.push({
      start: headerStart,
      end,
      header: headerLine,
      summary: findInjectionSummary(body),
    });
    cursor = end;
  }
  return ranges;
}

// Find the START position of the most useful bracketed header inside a
// segment that ends just before an OMO_INTERNAL_INITIATOR. Tries
// progressively more permissive patterns:
//   1. [SYSTEM DIRECTIVE: ...] at column 0
//   2. [SYSTEM DIRECTIVE: ...] anywhere
//   3. any bracketed header [...] at column 0
//   4. any bracketed header [...] anywhere
// Returns -1 when nothing matches; caller treats the whole segment as
// injection so the orphan marker still gets collapsed.
function findInjectionHeaderOffset(segment: string): number {
  const patterns: RegExp[] = [
    /(?:^|\n)\[SYSTEM DIRECTIVE:[^\]\n]+\]/,
    /\[SYSTEM DIRECTIVE:[^\]\n]+\]/,
    /(?:^|\n)\[[^\]\n]+\][^\n]*/,
    /\[[^\]\n]+\][^\n]*/,
  ];
  for (const re of patterns) {
    const m = segment.match(re);
    if (!m || m.index === undefined) continue;
    const offsetInMatch = m[0].startsWith("\n") ? 1 : 0;
    return m.index + offsetInMatch;
  }
  return -1;
}

function headerLineAt(text: string, headerStart: number): string {
  const eol = text.indexOf("\n", headerStart);
  const slice = eol < 0 ? text.slice(headerStart) : text.slice(headerStart, eol);
  return slice;
}

function mergeAndDedupe(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) {
      continue;
    }
    out.push(r);
  }
  return out;
}

export function parseOmoBlocks(text: string): OmoBlock[] {
  if (!text) return [{ kind: "user", text }];

  const ranges = mergeAndDedupe([
    ...collectInitiatorRanges(text),
    ...collectNonInitiatorRanges(text),
  ]);

  if (ranges.length === 0) return [{ kind: "user", text }];

  const blocks: OmoBlock[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      blocks.push({ kind: "user", text: text.slice(cursor, r.start) });
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
    blocks.push({ kind: "user", text: text.slice(cursor) });
  }
  return blocks;
}
