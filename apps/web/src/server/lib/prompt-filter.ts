// Strip ralph/ultrawork/system-reminder noise from prompts before storing
// the "filtered" form, and redact credential-looking values everywhere
// (both filtered and unfiltered) so the archive never holds a literal
// secret. Rules per spec - false positives on filtering are fine because
// the unfiltered (still credential-safe) text is always one click away.

const XML_NOISE_PATTERNS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/g,
  /<!-- OMO_INTERNAL_INITIATOR -->/g,
];

// Lines that open a directive block. Block extends until either a `---`
// separator line or a blank line followed by a non-bracket-starting line.
const BRACKET_DIRECTIVE_OPEN =
  /^\[(analyze-mode|search-mode|ultrawork|ULTRAWORK|plan-mode|RALPH LOOP[^\]]*|SYSTEM DIRECTIVE[^\]]*|Status[^\]]*)\]/;

// `[SYSTEM DIRECTIVE ...]` blocks are auto-fired by hooks and span the
// entire message body (header + nested [Status] + a "Remaining tasks"
// bulletlist). Standard blank+non-bracket termination misclassifies the
// listing rows. Treat SYSTEM DIRECTIVE as consume-to-`---`-or-EOF; if
// the user wants to attach real content to one of these, they separate
// with `---` (the convention they already use elsewhere).
const CONSUME_TO_END_DIRECTIVE = /^\[SYSTEM DIRECTIVE/;

const MANDATORY_DELEGATE_OPEN = /^MANDATORY delegate_task/;

// Standalone messages that are pure continuation pings. Compared
// case-insensitively after trimming the entire filtered output.
const SHORT_PINGS = new Set<string>([
  "continue",
  "continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
  "ping",
  "proceed",
  "go",
]);

// Lines that look like queue management instructions for me. Stripped
// line-by-line (the actual user content sits on the lines that follow).
const PRELUDE_LINE_PATTERNS: RegExp[] = [
  /^up next when this done:/i,
  /^queue right after:/i,
  /^update todos\.?$/i,
  /^final task to enqueue/i,
  /^remember to update your todos\.?$/i,
];

// Inline credential token patterns. Matched WHEREVER they appear in the
// text and replaced with [REDACTED:length=N]. Better a false-positive
// redaction than a leak.
const TOKEN_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /ghs_[A-Za-z0-9]{20,}/g,
  /xoxb-[A-Za-z0-9-]+/g,
  /xoxp-[A-Za-z0-9-]+/g,
  /xoxa-[A-Za-z0-9-]+/g,
  /AKIA[A-Z0-9]{16}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

// Fenced code blocks whose info-string declares env-like content. Whole
// block body redacted (we only need to know the block existed, not what
// was in it).
const FENCED_SECRETS_PATTERN =
  /```(env|dotenv|secrets|envfile|environment)\s*\n([\s\S]*?)\n?```/g;

// Per-line env-var-style assignment: ALL_CAPS=value, value length >=8.
// 'export ' prefix tolerated. Leading whitespace tolerated.
const ENV_VAR_LINE_PATTERN =
  /^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]{3,})=(\S{8,})(\s*)$/;

const MIN_FILTERED_PROSE_CHARS = 10;

export interface FilterResult {
  shouldArchive: boolean;
  filtered: string;
  unfiltered: string;
}

function redactValue(value: string): string {
  return `[REDACTED:length=${value.length}]`;
}

export function redactCredentials(text: string): string {
  let result = text;

  result = result.replace(FENCED_SECRETS_PATTERN, (_match, fence, body) => {
    return "```" + fence + "\n" + redactValue(body) + "\n```";
  });

  result = result
    .split("\n")
    .map((line) => {
      const m = line.match(ENV_VAR_LINE_PATTERN);
      if (!m) return line;
      const [, prefix, key, value, suffix] = m;
      return `${prefix}${key}=${redactValue(value)}${suffix}`;
    })
    .join("\n");

  for (const re of TOKEN_PATTERNS) {
    result = result.replace(re, (match) => redactValue(match));
  }

  return result;
}

function stripXmlNoise(text: string): string {
  let result = text;
  for (const re of XML_NOISE_PATTERNS) result = result.replace(re, "");
  return result;
}

function stripBracketDirectives(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const isDirective =
      BRACKET_DIRECTIVE_OPEN.test(trimmed) ||
      MANDATORY_DELEGATE_OPEN.test(trimmed);
    if (!isDirective) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const consumeToEnd = CONSUME_TO_END_DIRECTIVE.test(trimmed);
    i++;
    let sawNonBlank = false;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === "---") {
        i++;
        break;
      }
      if (
        !consumeToEnd &&
        sawNonBlank &&
        t === "" &&
        i + 1 < lines.length &&
        !lines[i + 1].trim().startsWith("[") &&
        !MANDATORY_DELEGATE_OPEN.test(lines[i + 1].trim())
      ) {
        i++;
        break;
      }
      if (t !== "") sawNonBlank = true;
      i++;
    }
  }
  return out.join("\n");
}

function stripPreludeLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !PRELUDE_LINE_PATTERNS.some((re) => re.test(t));
    })
    .join("\n");
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

export function filterPrompt(input: string): FilterResult {
  const unfiltered = redactCredentials(input).trim();
  let filtered = stripXmlNoise(unfiltered);
  filtered = stripBracketDirectives(filtered);
  filtered = stripPreludeLines(filtered);
  filtered = collapseBlankLines(filtered).trim();

  const lower = filtered.toLowerCase();
  const isPing = SHORT_PINGS.has(lower);
  const tooShort = filtered.length < MIN_FILTERED_PROSE_CHARS;
  const shouldArchive = !isPing && !tooShort;

  return { shouldArchive, filtered, unfiltered };
}
