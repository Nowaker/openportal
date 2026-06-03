#!/usr/bin/env bun
/**
 * One-shot migration: splits legacy AI_TODO.md into per-entry files under
 * ai-todo/, querying opencode.db to recover the originating session ID and
 * wall-clock datetime for each entry's verbatim user prompt.
 *
 * Output filenames follow the canonical format documented in AGENTS.md:
 *   ai-todo/<YYYY-MM-DD>_<HH-MM-SS>_<sessionid>_legacy-NNN_<slug>.md
 *
 * The `legacy-NNN` segment preserves the original `### N.` number so the
 * old `// per AI_TODO #138` cross-references resolve via filename grep.
 *
 * Run with: bun scripts/migrate-ai-todo.ts
 */

import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = "/home/nowaker/projekty/webapps/portal-ai-todo-restructure";
const AI_TODO_PATH = join(REPO_ROOT, "AI_TODO.md");
const OUT_DIR = join(REPO_ROOT, "ai-todo");
const DB_PATH = "/home/nowaker/.local/share/opencode/opencode.db";
const TZ_OFFSET = "-05:00";
const TZ_OFFSET_MIN = -5 * 60;

type CacheRow = { session_id: string; ms: number; text: string };

function toLocalDateParts(ms: number): {
  yyyy: string;
  mm: string;
  dd: string;
  hh: string;
  mi: string;
  ss: string;
} {
  const shifted = new Date(ms + TZ_OFFSET_MIN * 60_000);
  return {
    yyyy: String(shifted.getUTCFullYear()),
    mm: String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    dd: String(shifted.getUTCDate()).padStart(2, "0"),
    hh: String(shifted.getUTCHours()).padStart(2, "0"),
    mi: String(shifted.getUTCMinutes()).padStart(2, "0"),
    ss: String(shifted.getUTCSeconds()).padStart(2, "0"),
  };
}

function toFilenameStamp(ms: number): string {
  const p = toLocalDateParts(ms);
  return `${p.yyyy}-${p.mm}-${p.dd}_${p.hh}-${p.mi}-${p.ss}`;
}

function toIsoLocal(ms: number): string {
  const p = toLocalDateParts(ms);
  return `${p.yyyy}-${p.mm}-${p.dd}T${p.hh}:${p.mi}:${p.ss}${TZ_OFFSET}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 70)
    .replace(/-+$/, "") || "untitled";
}

function parseStatusAndCommit(parens: string): { status: string; commit: string } {
  const upper = parens.toUpperCase();
  let status = "PENDING";
  let commit = "";
  if (upper.startsWith("DONE")) {
    status = "DONE";
    const m = parens.match(/DONE\s*[-—–]\s*([a-f0-9]{7,40})\b/i);
    if (m) commit = m[1];
  } else if (upper.startsWith("Q-DEFERRED") || upper.startsWith("DEFERRED")) {
    status = "Q-DEFERRED";
  } else if (upper.startsWith("CANCELLED") || upper.startsWith("CANCELED")) {
    status = "CANCELLED";
  } else if (upper.startsWith("IN PROGRESS") || upper.startsWith("IN-PROGRESS") || upper.startsWith("IN_PROGRESS")) {
    status = "IN_PROGRESS";
  } else if (upper.startsWith("PENDING")) {
    status = "PENDING";
  }
  return { status, commit };
}

function extractStatusParens(titleLine: string): { title: string; statusRaw: string } {
  if (!titleLine.endsWith(")")) {
    return { title: titleLine, statusRaw: "PENDING" };
  }
  let depth = 0;
  let openIdx = -1;
  for (let i = titleLine.length - 1; i >= 0; i--) {
    const ch = titleLine[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      depth--;
      if (depth === 0) {
        openIdx = i;
        break;
      }
    }
  }
  if (openIdx <= 0) {
    return { title: titleLine, statusRaw: "PENDING" };
  }
  return {
    title: titleLine.slice(0, openIdx).trim(),
    statusRaw: titleLine.slice(openIdx + 1, -1).trim(),
  };
}

function extractPromptText(entryLines: string[]): string {
  let foundHeader = false;
  let inBlock = false;
  const collected: string[] = [];
  for (let i = 0; i < entryLines.length; i++) {
    const ln = entryLines[i];
    if (!foundHeader) {
      // Match all observed prompt-block intros: "User prompt(s)", "User-provided",
      // "Follow-up user prompt", and the variants with parenthesized qualifiers.
      if (/user[ -](prompt|provided)/i.test(ln)) {
        foundHeader = true;
      }
      continue;
    }
    if (ln.startsWith(">")) {
      collected.push(ln.replace(/^>\s?/, ""));
      inBlock = true;
    } else if (inBlock && ln.trim() === "") {
      // peek ahead — may be in-block blank if another `> ` follows
      let j = i + 1;
      while (j < entryLines.length && entryLines[j].trim() === "") j++;
      if (j < entryLines.length && entryLines[j].startsWith(">")) {
        collected.push("");
        continue;
      }
      break;
    } else if (inBlock) {
      break;
    }
  }
  return collected.join("\n").trim();
}

function loadDbCache(): CacheRow[] {
  console.error("Loading user-text parts from opencode.db ...");
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT m.session_id as session_id, m.time_created as ms, p.data as data
       FROM part p
       JOIN message m ON m.id = p.message_id
       WHERE json_extract(m.data, '$.role') = 'user'
         AND json_extract(p.data, '$.type') = 'text'`,
    )
    .all() as { session_id: string; ms: number; data: string }[];
  const cache: CacheRow[] = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.data);
      if (typeof parsed.text === "string" && parsed.text.length > 0) {
        cache.push({ session_id: r.session_id, ms: r.ms, text: parsed.text });
      }
    } catch {
      /* ignore */
    }
  }
  cache.sort((a, b) => a.ms - b.ms);
  db.close();
  console.error(`Loaded ${cache.length} user-text parts.`);
  return cache;
}

function findMatch(cache: CacheRow[], prompt: string): { session: string; ms: number } | null {
  if (prompt.length < 8) return null;

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (t.length >= 12 && !seen.has(t)) {
      seen.add(t);
      candidates.push(t);
    }
  };

  // Original prompt: try several prefix lengths.
  for (const len of [150, 80, 50, 30]) {
    if (len <= prompt.length) push(prompt.slice(0, len));
  }

  // Strip archive-only annotation prefixes the user did NOT type into opencode
  // (these were added by the AI when rolling the prompt into AI_TODO.md).
  const stripped = prompt
    .replace(/^enqueue[^:\n]*:\s*\n?/i, "")
    .replace(/^add[^:\n]{0,40}:\s*\n?/i, "")
    .replace(/^after done[^:\n]{0,40}:\s*\n?/i, "")
    .replace(/^todo\+?=\s*/i, "")
    .replace(/^h:\s*\n?/i, "");
  if (stripped !== prompt) {
    for (const len of [150, 80, 50, 30]) {
      if (len <= stripped.length) push(stripped.slice(0, len));
    }
  }

  // After-first-colon-and-space slices catch prompts like
  //   "file browser: I only see ... letter j"
  // where the literal user message in opencode lacks the "file browser:" lead-in.
  const colonIdx = prompt.indexOf(": ");
  if (colonIdx > 0 && colonIdx < 40) {
    const afterColon = prompt.slice(colonIdx + 2).trim();
    for (const len of [150, 80, 50, 30]) {
      if (len <= afterColon.length) push(afterColon.slice(0, len));
    }
  }

  // For short prompts (under the 40-char tail threshold) just try the whole text.
  if (prompt.length >= 12 && prompt.length < 80) push(prompt);

  // Offset slices catch prompts whose distinctive content sits past a generic
  // opener (e.g. "ok so:", "btw", "another thing - ").
  for (const offset of [10, 30, 60, 100, 150]) {
    if (offset + 30 <= prompt.length) push(prompt.slice(offset, offset + 50));
  }

  // Tail slice catches prompts whose lead-in differs from the typed text
  // but whose body is preserved verbatim.
  if (prompt.length >= 40) push(prompt.slice(-Math.min(80, prompt.length)));

  for (const key of candidates) {
    for (const r of cache) {
      if (r.text.includes(key)) {
        return { session: r.session_id, ms: r.ms };
      }
    }
  }
  return null;
}

function main() {
  const aiTodo = readFileSync(AI_TODO_PATH, "utf8");
  const lines = aiTodo.split("\n");

  const preambleLines: string[] = [];
  const entryBlocks: { n: number; lines: string[] }[] = [];
  let cur: { n: number; lines: string[] } | null = null;

  for (const ln of lines) {
    const m = ln.match(/^### (\d+)\. /);
    if (m) {
      if (cur) entryBlocks.push(cur);
      cur = { n: parseInt(m[1], 10), lines: [ln] };
    } else if (cur) {
      cur.lines.push(ln);
    } else {
      preambleLines.push(ln);
    }
  }
  if (cur) entryBlocks.push(cur);

  console.error(`Parsed ${entryBlocks.length} numbered entries; preamble = ${preambleLines.length} lines`);

  mkdirSync(OUT_DIR, { recursive: true });

  const cache = loadDbCache();

  let matched = 0;
  let unmatched = 0;
  const unmatchedNumbers: number[] = [];
  const usedFilenames = new Set<string>();

  // Synthesised fallback timestamp: 2024-01-01 00:00:00 -05:00 + N seconds
  // Use entry.n directly so ordering is preserved in the filesystem.
  const FALLBACK_BASE_MS = Date.parse(`2024-01-01T00:00:00${TZ_OFFSET}`);

  for (const entry of entryBlocks) {
    const headingLine = entry.lines[0];
    const headingM = headingLine.match(/^### (\d+)\. (.+)$/);
    if (!headingM) continue;
    const titleAndStatus = headingM[2];
    const { title, statusRaw } = extractStatusParens(titleAndStatus);
    const { status, commit } = parseStatusAndCommit(statusRaw);

    const promptText = extractPromptText(entry.lines);
    let sessionId = "ses_unknown";
    let ms: number;
    if (promptText.length > 0) {
      const hit = findMatch(cache, promptText);
      if (hit) {
        sessionId = hit.session;
        ms = hit.ms;
        matched++;
      } else {
        ms = FALLBACK_BASE_MS + entry.n * 1000;
        unmatched++;
        unmatchedNumbers.push(entry.n);
      }
    } else {
      ms = FALLBACK_BASE_MS + entry.n * 1000;
      unmatched++;
      unmatchedNumbers.push(entry.n);
    }

    const stamp = toFilenameStamp(ms);
    const queuedAt = toIsoLocal(ms);
    const slug = slugify(title);
    const legacyN = String(entry.n).padStart(3, "0");
    let filename = `${stamp}_${sessionId}_legacy-${legacyN}_${slug}.md`;

    // Defensive uniqueness — should never trip given legacy-NNN segment.
    let suffix = 1;
    while (usedFilenames.has(filename)) {
      filename = `${stamp}_${sessionId}_legacy-${legacyN}_${slug}_${suffix}.md`;
      suffix++;
    }
    usedFilenames.add(filename);

    const bodyRaw = entry.lines.slice(1).join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    const fileContent =
      `---\n` +
      `status: ${status}\n` +
      `commit: ${commit}\n` +
      `session: ${sessionId}\n` +
      `queued_at: ${queuedAt}\n` +
      `legacy_number: ${entry.n}\n` +
      `---\n\n` +
      `# ${title}\n\n` +
      bodyRaw +
      `\n`;

    writeFileSync(join(OUT_DIR, filename), fileContent);
  }

  // Preserve the AI_TODO.md preamble (EXPLICIT CANCELLATIONS, STANDING RULES,
  // COMPLETED THEMES) as an archive file so context isn't lost when the legacy
  // file is deleted.
  const preambleBody = preambleLines.join("\n").replace(/\n+$/, "").trim();
  if (preambleBody.length > 0) {
    const preambleFilename = `_archive-legacy-preamble.md`;
    const archiveContent =
      `---\n` +
      `status: ARCHIVE\n` +
      `commit:\n` +
      `session: ses_unknown\n` +
      `queued_at: 2024-01-01T00:00:00${TZ_OFFSET}\n` +
      `legacy_number: 0\n` +
      `---\n\n` +
      `# Legacy AI_TODO.md preamble (archived)\n\n` +
      `The following block was the header of the legacy \`AI_TODO.md\` file ` +
      `before its per-entry migration. It captured cross-cutting context: ` +
      `explicit cancellations (calls the user made to NEVER reopen certain ` +
      `topics), standing rules now codified in \`AGENTS.md\`, and a roll-up ` +
      `of completed themes with their canonical commit hashes. Preserved ` +
      `verbatim for historical reference; superseded for active queue use ` +
      `by the per-entry files in this directory.\n\n` +
      `---\n\n` +
      preambleBody +
      `\n`;
    writeFileSync(join(OUT_DIR, preambleFilename), archiveContent);
  }

  console.error("");
  console.error(`Matched: ${matched}/${entryBlocks.length}`);
  console.error(`Unmatched (ses_unknown fallback): ${unmatched}/${entryBlocks.length}`);
  if (unmatchedNumbers.length > 0) {
    console.error(`Unmatched entry numbers: ${unmatchedNumbers.join(", ")}`);
  }
}

main();
