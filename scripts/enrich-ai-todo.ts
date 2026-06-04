#!/usr/bin/env bun
/**
 * Post-migration enrichment pass for ai-todo/ entries.
 *
 * Replaces the single `commit: <sha>` frontmatter field with a richer
 * `commits:` block (attributed / on_main / reverted) plus a `validated:`
 * block carrying the validation timestamp and the SHA of
 * origin/main-nowaker at validation time. Lets a reviewer reproduce the
 * on_main verdict from the same snapshot the agent saw.
 *
 * Idempotent: re-running rewrites the blocks in place. Existing
 * `commits:` and `validated:` blocks are dropped and regenerated.
 *
 * Empty title-only ses_unknown entries (legacy #129, #130) are deleted.
 *
 * Run with: bun scripts/enrich-ai-todo.ts
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = "/home/nowaker/projekty/webapps/portal-ai-todo-restructure";
const AI_TODO_DIR = join(REPO_ROOT, "ai-todo");
const TZ_OFFSET = "-05:00";
const TZ_OFFSET_MIN = -5 * 60;

const DELETE_FILES = new Set<string>([
  "2024-01-01_00-02-09_ses_unknown_legacy-129_clean-session-ux-expose-detailed-flags-mode-semantics-live-progress-an.md",
  "2024-01-01_00-02-10_ses_unknown_legacy-130_session-id-mentions-must-always-linkize.md",
]);

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").replace(/\n+$/, "");
}

function gitIsAncestor(sha: string, ref: string): boolean {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", sha, ref], { cwd: REPO_ROOT });
  return r.status === 0;
}

function isoLocal(d: Date): string {
  const shifted = new Date(d.getTime() + TZ_OFFSET_MIN * 60_000);
  const yyyy = String(shifted.getUTCFullYear());
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mi = String(shifted.getUTCMinutes()).padStart(2, "0");
  const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${TZ_OFFSET}`;
}

interface Commit {
  full: string;
  short: string;
  subject: string;
  authorMs: number;
}

function loadAllCommits(): { all: Commit[]; bySha: Map<string, Commit> } {
  const raw = git(["log", "--all", "--format=%H\x1f%at\x1f%s"]);
  const all: Commit[] = [];
  const bySha = new Map<string, Commit>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [full, atStr, ...rest] = line.split("\x1f");
    if (!full) continue;
    const c: Commit = {
      full,
      short: full.substring(0, 12),
      subject: rest.join("\x1f"),
      authorMs: Number(atStr) * 1000,
    };
    all.push(c);
    bySha.set(c.full, c);
    bySha.set(c.short, c);
    bySha.set(c.full.substring(0, 7), c);
    bySha.set(c.full.substring(0, 8), c);
  }
  return { all, bySha };
}

function loadMainShas(): { mainSet: Set<string>; revertMap: Map<string, string> } {
  const raw = git(["log", "origin/main-nowaker", "--format=%H\x1f%s"]);
  const mainSet = new Set<string>();
  const revertMap = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [full, subject] = line.split("\x1f");
    if (!full) continue;
    mainSet.add(full);
    if (!subject) continue;
    const m = subject.match(/Revert.*?\b([a-f0-9]{7,40})\b/i);
    if (m) {
      const ref = m[1].substring(0, 7);
      revertMap.set(ref, full.substring(0, 12));
    }
  }
  return { mainSet, revertMap };
}

function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  const fmRaw = m[1];
  const body = m[2];
  const fm: Record<string, string> = {};
  let skipNested: string | null = null;
  for (const line of fmRaw.split("\n")) {
    if (/^\s/.test(line) && line.trim().length > 0) {
      // indented line — part of a nested block we're dropping
      continue;
    }
    skipNested = null;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k === "commits" || k === "validated") {
      skipNested = k;
      continue;
    }
    fm[k] = v;
  }
  return { fm, body };
}

function extractTitle(body: string): string {
  for (const line of body.split("\n")) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return "";
}

interface TopicSearchOpts {
  title: string;
  queuedAtMs: number | null;
  all: Commit[];
}

function topicSearch(opts: TopicSearchOpts): string[] {
  const { title, queuedAtMs, all } = opts;
  if (!title) return [];
  // Extract distinctive lowercase tokens (>=5 chars, alphanumeric)
  const stop = new Set([
    "the", "and", "for", "with", "from", "into", "must", "should",
    "needs", "fix", "add", "remove", "audit", "review", "after",
    "before", "regression", "bug", "feature", "session", "sessions",
    "portal", "openportal", "opencode", "always", "never", "minor",
    "design", "question", "doc", "docs", "todo", "issue", "branch",
  ]);
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 5 && !stop.has(t));
  if (tokens.length === 0) return [];
  const keyTokens = tokens.slice(0, 4);
  const matches = all.filter((c) => {
    if (queuedAtMs !== null) {
      const delta = c.authorMs - queuedAtMs;
      // Allow commits up to 14 days after queue + 2 days before
      if (delta < -2 * 86_400_000 || delta > 14 * 86_400_000) return false;
    }
    const subj = c.subject.toLowerCase();
    return keyTokens.every((t) => subj.includes(t));
  });
  // Only accept a unique match
  if (matches.length === 1) return [matches[0].short];
  return [];
}

interface EntryReport {
  file: string;
  status: string;
  attributed: string[];
  on_main: string[];
  reverted: string | false;
  legacy: string;
  topicMatched: boolean;
}

function buildFrontmatter(
  fm: Record<string, string>,
  attributed: string[],
  on_main: string[],
  reverted: string | false,
  validatedAt: string,
  mainTip: string,
): string {
  const order = ["status", "session", "queued_at", "legacy_number"];
  const lines: string[] = [];
  for (const k of order) {
    if (k in fm) lines.push(`${k}: ${fm[k]}`);
  }
  for (const k of Object.keys(fm)) {
    if (order.includes(k)) continue;
    if (k === "commit") continue;
    lines.push(`${k}: ${fm[k]}`);
  }
  lines.push("commits:");
  if (attributed.length === 0) {
    lines.push("  attributed: []");
  } else {
    lines.push("  attributed:");
    for (const s of attributed) lines.push(`    - ${s}`);
  }
  if (on_main.length === 0) {
    lines.push("  on_main: []");
  } else {
    lines.push("  on_main:");
    for (const s of on_main) lines.push(`    - ${s}`);
  }
  lines.push(`  reverted: ${reverted === false ? "false" : reverted}`);
  lines.push("validated:");
  lines.push(`  at: ${validatedAt}`);
  lines.push(`  main_tip: ${mainTip}`);
  return lines.join("\n");
}

function main(): void {
  console.error("Fetching origin/main-nowaker tip + commit cache...");
  const mainTip = git(["rev-parse", "--short=12", "origin/main-nowaker"]);
  if (!mainTip) {
    console.error("FATAL: cannot rev-parse origin/main-nowaker");
    process.exit(1);
  }
  const validatedAt = isoLocal(new Date());

  const { all, bySha } = loadAllCommits();
  const { mainSet, revertMap } = loadMainShas();
  console.error(`Cached ${all.length} commits, ${mainSet.size} on origin/main-nowaker, ${revertMap.size} revert refs.`);
  console.error(`mainTip=${mainTip} validatedAt=${validatedAt}`);

  const files = readdirSync(AI_TODO_DIR)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => f !== "README.md")
    .filter((f) => !f.startsWith("_archive"));

  const reports: EntryReport[] = [];
  let deleted = 0;

  for (const name of files) {
    const path = join(AI_TODO_DIR, name);
    if (DELETE_FILES.has(name)) {
      unlinkSync(path);
      deleted++;
      console.error(`DELETED ${name}`);
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      console.error(`SKIP ${name}: read error ${(e as Error).message}`);
      continue;
    }
    let parsed: { fm: Record<string, string>; body: string };
    try {
      parsed = parseFrontmatter(text);
    } catch (e) {
      console.error(`SKIP ${name}: ${(e as Error).message}`);
      continue;
    }
    const { fm, body } = parsed;

    // Resolve attributed SHAs from explicit commit:
    const attributed: string[] = [];
    const explicit = (fm.commit ?? "").trim();
    let topicMatched = false;
    if (explicit) {
      const ref = bySha.get(explicit) ?? bySha.get(explicit.substring(0, 12)) ?? bySha.get(explicit.substring(0, 7));
      if (ref) {
        attributed.push(ref.short);
      } else {
        // SHA didn't resolve — keep the raw string but truncated, so audit can find it
        attributed.push(explicit.substring(0, 12));
      }
    } else if ((fm.status ?? "").trim() === "DONE") {
      const title = extractTitle(body);
      let queuedAtMs: number | null = null;
      if (fm.queued_at) {
        const t = Date.parse(fm.queued_at);
        if (!isNaN(t)) queuedAtMs = t;
      }
      const found = topicSearch({ title, queuedAtMs, all });
      if (found.length > 0) {
        attributed.push(...found);
        topicMatched = true;
      }
    }

    // on_main check
    const on_main: string[] = [];
    for (const short of attributed) {
      const c = bySha.get(short);
      if (c && mainSet.has(c.full)) on_main.push(short);
    }

    // Revert detection
    let reverted: string | false = false;
    for (const short of attributed) {
      if (on_main.includes(short)) continue;
      const c = bySha.get(short);
      if (!c) continue;
      const probe7 = c.full.substring(0, 7);
      const probe8 = c.full.substring(0, 8);
      const revertSha = revertMap.get(probe7) ?? revertMap.get(probe8) ?? revertMap.get(short);
      if (revertSha) {
        reverted = revertSha;
        break;
      }
    }

    const newFm = buildFrontmatter(fm, attributed, on_main, reverted, validatedAt, mainTip);
    const newText = `---\n${newFm}\n---\n${body}`;
    writeFileSync(path, newText);

    reports.push({
      file: name,
      status: (fm.status ?? "").trim(),
      attributed,
      on_main,
      reverted,
      legacy: fm.legacy_number ?? "",
      topicMatched,
    });
  }

  // Summary
  const total = reports.length;
  const withAttributed = reports.filter((r) => r.attributed.length > 0).length;
  const withOnMain = reports.filter((r) => r.on_main.length > 0).length;
  const doneNoAttributed = reports.filter((r) => r.status === "DONE" && r.attributed.length === 0);
  const doneAttributedNotOnMain = reports.filter((r) => r.status === "DONE" && r.attributed.length > 0 && r.on_main.length === 0);
  const revertedList = reports.filter((r) => r.reverted !== false);
  const topicMatched = reports.filter((r) => r.topicMatched);

  console.error("");
  console.error("=========================================");
  console.error(`Entries processed:           ${total}`);
  console.error(`Entries deleted:             ${deleted}`);
  console.error(`With attributed SHA:         ${withAttributed}`);
  console.error(`With on_main SHA:            ${withOnMain}`);
  console.error(`DONE + attributed empty:     ${doneNoAttributed.length}`);
  console.error(`DONE + attributed but no on_main: ${doneAttributedNotOnMain.length}`);
  console.error(`Reverted (true):             ${revertedList.length}`);
  console.error(`Topic-matched (heuristic):   ${topicMatched.length}`);
  console.error("=========================================");

  if (doneAttributedNotOnMain.length > 0) {
    console.error("\nDONE but attributed SHAs missing from origin/main-nowaker (potential lost work):");
    for (const r of doneAttributedNotOnMain) {
      console.error(`  legacy=${r.legacy} attributed=${r.attributed.join(",")} reverted=${r.reverted} file=${r.file}`);
    }
  }
  if (revertedList.length > 0) {
    console.error("\nReverted entries (definite drops):");
    for (const r of revertedList) {
      console.error(`  legacy=${r.legacy} attributed=${r.attributed.join(",")} reverted=${r.reverted} file=${r.file}`);
    }
  }
  if (topicMatched.length > 0) {
    console.error("\nTopic-search matches (heuristic, please audit):");
    for (const r of topicMatched) {
      console.error(`  legacy=${r.legacy} -> ${r.attributed.join(",")} file=${r.file}`);
    }
  }
}

main();
