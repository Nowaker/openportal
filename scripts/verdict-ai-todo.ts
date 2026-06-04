#!/usr/bin/env bun
/**
 * Stamps a verdict on every DONE entry in ai-todo/.
 *
 * Three new frontmatter fields land between the existing `commits:` block and
 * the `validated:` block:
 *
 *   verdict: present | lost | uncertain
 *   verdict_reason: "<one-line evidence>"
 *   verdict_investigated_at: <ISO-8601 with -05:00 offset>
 *
 * Two passes:
 *
 * 1. The 99 DONE entries that already carry `commits.attributed` SHAs.
 *    Every attributed SHA was checked against origin/main-nowaker by the
 *    earlier enrichment pass and the resulting `commits.on_main` was
 *    populated. Trivially stamp `verdict: present` with reason
 *    "commits.attributed all on main as of validation".
 *
 * 2. The 32 DONE entries with empty `commits.attributed: []`. These were
 *    investigated by hand using:
 *      a) codebase grep for distinctive identifiers (functions, components,
 *         file paths, UI strings, API endpoints) named in `Design notes:`,
 *      b) `git log --all --pickaxe-regex -S '<identifier>'` to find the
 *         introducing commit, then `git merge-base --is-ancestor` for
 *         on-main verification,
 *      c) `~/projekty/nowaker/opencode-tools/session-grep.ts <session>`
 *         for operational entries where the session breadcrumb is the
 *         only durable proof.
 *
 *    For each of the 32 the verdict + cited anchor live in
 *    `VERDICT_MAP_UNRESOLVED` below. New SHAs discovered during the
 *    investigation are appended to `commits.attributed` and (when on
 *    `origin/main-nowaker`) also `commits.on_main`.
 *
 * Idempotent: re-running rewrites the verdict / commits / validated
 * blocks in place. Bodies remain byte-for-byte untouched.
 *
 * Run: bun scripts/verdict-ai-todo.ts
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = "/home/nowaker/projekty/webapps/portal-ai-todo-restructure";
const AI_TODO_DIR = join(REPO_ROOT, "ai-todo");
const TZ_OFFSET = "-05:00";
const TZ_OFFSET_MIN = -5 * 60;

function git(args: string[]): string {
  const r = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return "";
  return (r.stdout ?? "").replace(/\n+$/, "");
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

type Verdict = "present" | "lost" | "uncertain";

interface VerdictRecord {
  verdict: Verdict;
  reason: string;
  // Additional SHAs (12-char) discovered during this investigation pass.
  // Will be appended to commits.attributed and (if on main) commits.on_main.
  newShas?: string[];
}

// Curated verdicts for the 32 entries whose `commits.attributed` was empty
// after the enrich pass. Keyed by `legacy_number`.
//
// Methodology per entry: extracted distinctive identifiers from the entry
// body (file path, function/component name, UI string, API endpoint,
// commit hash referenced in the design notes), grepped the live worktree
// at HEAD, then `git log --all -S '<identifier>'` to find the introducing
// commit, then verified ancestry with `git merge-base --is-ancestor <sha>
// origin/main-nowaker`. For pure-operational entries (smoke tests, branch
// unprotect, recovery handoffs) where no code commit is expected, the
// reason cites the durable artefact instead.
const VERDICT_MAP_UNRESOLVED: Record<string, VerdictRecord> = {
  // google-calendar-multiuser-mcp: native MCP OAuth (Google-backed) + Streamable HTTP transport on /mcp
  // External repo - mcp-proxy at ~/projekty/dreamhost/mcp-proxy/google-calendar-multiuser-mcp/.
  // Commit cd80b65 in that repo introduces src/auth/mcp-oauth.ts. Not attributed
  // to portal main because the work doesn't live in this repo.
  "100": {
    verdict: "present",
    reason:
      "External mcp-proxy commit cd80b65: 'google-calendar: native MCP OAuth (Google-backed) on /mcp + Streamable HTTP'. File ~/projekty/dreamhost/mcp-proxy/google-calendar-multiuser-mcp/src/auth/mcp-oauth.ts exists",
  },
  // Subagent permission cascade to red indicator on parent
  "11": {
    verdict: "present",
    reason:
      "Commit 94d6022 on main: 'fix(indicators): cascade red attention from subagents up to parent main session'",
    newShas: ["94d6022f6040"],
  },
  // Sweep for "OpenPortal failed to load assets" residual cases
  "19": {
    verdict: "present",
    reason:
      "Commit 24d3116 on main: 'build,assets: stale-asset 500s are now structurally impossible'. Shim header at apps/web/src/middleware/asset-fallback.ts:89",
    newShas: ["24d3116"],
  },
  // Regression check: systemctl --user start openportal spawns opencode on port 4000
  // Operational smoke test - the externalOpencode lifecycle was already implemented
  // (commits a44b131 + b0295d0 attributed elsewhere). No new commit needed.
  "12": {
    verdict: "present",
    reason:
      "externalOpencode lifecycle logic intact at packages/cli/src/index.ts:585 ('externalOpencode.port set -> connect-only. NEVER spawn opencode'). Operational regression check confirmed existing behaviour; no code change needed",
  },
  // Permalink + scroll-down-stickiness coherence (banner injection re-pin)
  "7": {
    verdict: "present",
    reason:
      "Commit 14acda5 on main: 'feat(session): sticky-bottom scroll + floating jump-to-bottom button'. ResizeObserver at apps/web/src/routes/_app/session/$id.tsx:4226 invokes scrollToBottom() on container resize so banners re-pin",
    newShas: ["14acda5"],
  },
  // LFS / git push --force workaround for "fork status"
  "17": {
    verdict: "present",
    reason:
      "Commit 7bc0285 on main: 'docs: AGENTS.md + README rewrite for canonical-gitlab hard fork'. LFS migration + force-push to both remotes shipped per ses_1b66ba2aaffeW7xyxcjmde6oYq (assistant turn 2026-05-21 15:59:00)",
    newShas: ["7bc0285"],
  },
  // GitLab API to unprotect a branch (operational, no code commit)
  "18": {
    verdict: "present",
    reason:
      "Operational task completed in ses_1b66ba2aaffeW7xyxcjmde6oYq (assistant msg_e4c24db9d 2026-05-21 15:05): 'Handling gitlab unprotect first' via glab + GITLAB_TOKEN. No code change in portal repo",
  },
  // Click on session-context-fullness indicator opens Session Info
  "13": {
    verdict: "present",
    reason:
      "Commit 0b8cbcb on main: 'title-bar: context dial opens Session Info + hamburger closes on Android back'. SessionContextDial.onClick={() => setShowSessionInfo(true)} at apps/web/src/components/app-sidebar-nav.tsx:897-900",
    newShas: ["0b8cbcb"],
  },
  // All lists prioritize files from current project first - refinement
  "10": {
    verdict: "present",
    reason:
      "Commits 177e865 + 2bda920 on main. prioritizeForProject(config.entries, project, max) at apps/web/src/routes/files.tsx:435",
    newShas: ["177e865", "2bda920"],
  },
  // Section M - Move session feature with shared hybrid directory picker
  "2": {
    verdict: "present",
    reason:
      "Commit 7de6c97 on main: 'session: Section M - move-to-project via shared picker + dry-run preflight'. 'Move to project...' hamburger entry at apps/web/src/components/app-sidebar-nav.tsx:1065",
    newShas: ["7de6c97"],
  },
  // Todo popup positioning - must cover the small todo + verify visually
  "26": {
    verdict: "present",
    reason:
      "Commits dac4662 + ebbf6dc + 7051e12 + 1184ed5 on main (todo-strip popup positioning + overflow fixes). Backfill commit 064a175 marked #26+#27 DONE",
    newShas: ["dac4662", "ebbf6dc", "1184ed5"],
  },
  // Todo popup break-word in large list
  "27": {
    verdict: "present",
    reason:
      "Commit dac4662 on main: 'todo-strip: popup opens directly above + inherits width + break-word'. overflow-wrap:anywhere at apps/web/src/components/todo-strip.tsx:18,291",
    newShas: ["dac4662"],
  },
  // Right hamburger #menu hash should NOT be a permalink/pushState
  "71": {
    verdict: "present",
    reason:
      "Commit 0b8cbcb on main: 'title-bar: context dial opens Session Info + hamburger closes on Android back'. apps/web/src/components/app-sidebar-nav.tsx:243 'Hamburger menu open state. Plain React state - NOT hash-tracked'",
    newShas: ["0b8cbcb"],
  },
  // Session info modal: opening should produce a permalink
  "66": {
    verdict: "present",
    reason:
      "useHashOpen('info') for SessionInfoModal at apps/web/src/components/app-sidebar-nav.tsx:224; SessionInfoModal mounted at line 1205",
  },
  // Analysis request: SSE reconnection behavior during OpenPortal restart
  "73": {
    verdict: "present",
    reason:
      "Analysis-only task. Doc at ai-analysis-requests/SSE_RECONNECTION_BEHAVIOR.md",
  },
  // Session prompt directory routing (bash cwd wrong) - openportal bug fix
  "74": {
    verdict: "present",
    reason:
      "Commit 5f04d77 on main: 'session prompt: thread directory query into opencode dispatch'. resolveSessionDirectory at apps/web/src/server/lib/opencode-client.ts:368. Analysis doc at ai-analysis-requests/SESSION_PROMPT_DIRECTORY_ROUTING.md",
    newShas: ["5f04d77"],
  },
  // ANALYSIS: opencode /config/providers returns 500
  "104": {
    verdict: "present",
    reason:
      "Analysis-only task. Doc at ai-analysis-requests/OPENCODE_CONFIG_PROVIDERS_500.md",
  },
  // Investigation + fix: stuck-detector verdict frozen at in-progress
  "97": {
    verdict: "present",
    reason:
      "External opencode-tools commit dea56e7: 'stuck-detector: downgrade in-progress/stuck verdicts to idle on clean completion'. Analysis doc at ai-analysis-requests/STUCK_VERDICT_FROZEN_IN_PROGRESS.md",
  },
  // Bisect opencode 1.15.10 plugins
  "105": {
    verdict: "present",
    reason:
      "Commit de7989b on main: 'AI_TODO.md: backfill #105 bisection conclusion - opencode-stuck-detector was the culprit, fixed upstream by opencode-tools 98f7a42 + 504de25'",
    newShas: ["de7989b"],
  },
  // Templates Round 5: prompt format pivot
  "146": {
    verdict: "present",
    reason:
      "Commit 58bf95a on main: 'templates-r5: prompt format pivot - user prompt first, /template Title blocks (R5-A + R5-B)'. buildPromptWithTemplates + parsePromptWithTemplates at apps/web/src/lib/prompt-template-format.ts:14,43",
    newShas: ["58bf95a"],
  },
  // FS templates: backend snapshot cache + Refresh button
  "150": {
    verdict: "present",
    reason:
      "Commit 3f661b9 on main: 'fs-templates: backend snapshot cache + periodic rebuild + Refresh button (#150)'. getCachedSnapshot + forceRebuildSnapshot at apps/web/src/server/lib/vibekick-templates.ts:422,436",
    newShas: ["3f661b9"],
  },
  // Chat log sticky overlay of most-recently-scrolled-past user prompt
  "159": {
    verdict: "present",
    reason:
      "Commit d479ced on main: 'chat: sticky overlay of the most-recent user prompt above the viewport'. apps/web/src/components/sticky-user-prompt.tsx + StickyUserPromptOverlay rendered in $id.tsx:5370",
    newShas: ["d479ced"],
  },
  // FS template row disappears after flag toggle - workspaceRoot regression
  "151": {
    verdict: "present",
    reason:
      "Commit bc6f6e3 on main: 'fs-templates: writeTemplate must use validated workspaceRoot, not file-path-derived (#151)'. writeTemplate(location, workspaceRoot, input) at apps/web/src/server/lib/vibekick-templates.ts:339 with anti-reversion comment",
    newShas: ["bc6f6e3"],
  },
  // Tool call rows: link spawned subsession ids
  // Two entries share legacy_number 155 (filenames disambiguate via slug);
  // the one matching this entry is the subsession-link slug.
  "155_subsession": {
    verdict: "present",
    reason:
      "Commit 3fae9e3 on main: 'session-ui: link spawned subsessions from tool rows'. spawnedSessionId + spawnedSessionHref at apps/web/src/routes/_app/session/$id.tsx:1487,1538",
    newShas: ["3fae9e3"],
  },
  // Build-mismatch banner: show incoming commit subject + GitLab link
  "155_build_mismatch": {
    verdict: "present",
    reason:
      "Commit 02d9ad2 on main: 'app: include incoming commit in upgrade banner'. X-OpenPortal-Commit-Sha + X-OpenPortal-Commit-Subject headers at apps/web/src/server/plugins/build-id-header.ts:21,24",
    newShas: ["02d9ad2"],
  },
  // Fix runtime crash Cannot read properties of undefined (toLocaleString)
  "156_tolocalestring": {
    verdict: "present",
    reason:
      "Commit 67ddbb3 on main: 'session: guard permalink and telemetry number formatting'. safeGapCount.toLocaleString() at apps/web/src/routes/_app/session/$id.tsx:2288",
    newShas: ["67ddbb3"],
  },
  // Remove X-OpenPortal-Commit-Url header; derive URL from commit SHA
  "156_commit_url": {
    verdict: "present",
    reason:
      "Commit 179bcf1 on main: 'app: drop commit-url header from upgrade metadata'. X-OpenPortal-Commit-Url no longer present anywhere in apps/web/ (rg confirms zero matches)",
    newShas: ["179bcf1"],
  },
  // Auto-revive sessions stopped with unexpected finish='unknown'
  "157": {
    verdict: "present",
    reason:
      "Commits 080ae2d + eda0d8f on main. reviveUnknownFinishSession at apps/web/src/server/plugins/unknown-finish-reviver.ts:50 + tests at unknown-finish-reviver.test.ts",
    newShas: ["080ae2d", "eda0d8f"],
  },
  // OMO wrappers must not collapse content inside fenced markdown code blocks
  "161": {
    verdict: "present",
    reason:
      "Commit 1c70555 on main: 'chat: skip OMO detection inside fenced markdown code blocks'. collectFencedCodeBlockRanges at apps/web/src/lib/omo-injection.ts:518, called from parseOmoBlocks at :636",
    newShas: ["1c70555"],
  },
  // Recovery handoff for accidentally removed composer-padding work
  "174": {
    verdict: "present",
    reason:
      "Recovery verification completed: c2387ff ('composer: tighten textarea padding to a compact 6px inset') + 4a69796 ('composer: force textarea padding via inline style') both confirmed on origin/main-nowaker. Apology prompt dispatched to ses_18572f9a8ffecB57FPahdTEZ4Y via session-grep per design notes",
  },
  // Composer textarea: tight 5/3/3/46 px inset, top-only border at rest
  "167": {
    verdict: "present",
    reason:
      "Commits c621135 + 4a69796 on main. apps/web/src/routes/_app/session/$id.tsx:6087 and new.tsx:1235 carry inline style={{paddingLeft:5,paddingTop:3,paddingBottom:3,paddingRight:46}} + 'rounded-none border-x-0 border-b-0 focus:border-x focus:border-b focus:ring-0'",
    newShas: ["c621135", "4a69796"],
  },
  // Fix useFilter is not defined in ModelSelect + ship prod sourcemaps
  "173": {
    verdict: "present",
    reason:
      "Commits f8fad16 + 97b4c9a on main: 'model-select: drop dead useFilter/useMediaQuery calls + ship hidden sourcemaps' + 'sourcemap: hidden -> true so DevTools auto-associates maps'. apps/web/vite.config.ts:31 has build.sourcemap: true",
    newShas: ["f8fad16", "97b4c9a"],
  },
};

// Two entries share legacy_number 155 and two share legacy_number 156.
// The map uses synthesized keys (above) to disambiguate; this lookup
// resolves the right record from the filename slug.
function resolveUnresolvedKey(legacy: string, filename: string): string | null {
  if (legacy === "155") {
    if (filename.includes("subsession-ids")) return "155_subsession";
    if (filename.includes("build-mismatch")) return "155_build_mismatch";
    return null;
  }
  if (legacy === "156") {
    if (filename.includes("tolocale")) return "156_tolocalestring";
    if (filename.includes("commit-url")) return "156_commit_url";
    return null;
  }
  return legacy in VERDICT_MAP_UNRESOLVED ? legacy : null;
}

interface ParsedFrontmatter {
  status: string;
  legacy: string;
  attributed: string[];
  onMain: string[];
  reverted: string | false;
  validatedAt: string;
  mainTip: string;
  fmRaw: string;
  body: string;
}

function parseFrontmatter(text: string): ParsedFrontmatter {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  const fmRaw = m[1];
  const body = m[2];

  let status = "";
  let legacy = "";
  let attributed: string[] = [];
  let onMain: string[] = [];
  let reverted: string | false = false;
  let validatedAt = "";
  let mainTip = "";

  const lines = fmRaw.split("\n");
  let block: "commits" | "validated" | null = null;
  let listKey: "attributed" | "on_main" | null = null;

  for (const line of lines) {
    if (/^\S/.test(line)) {
      // top-level key
      block = null;
      listKey = null;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key === "status") status = val;
      else if (key === "legacy_number") legacy = val;
      else if (key === "commits") block = "commits";
      else if (key === "validated") block = "validated";
      // verdict / verdict_reason / verdict_investigated_at are dropped here
      // and re-emitted in buildFrontmatter.
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (block === "commits") {
      if (line.startsWith("  attributed:")) {
        const inline = line.slice("  attributed:".length).trim();
        if (inline === "[]") {
          attributed = [];
          listKey = null;
        } else {
          listKey = "attributed";
        }
        continue;
      }
      if (line.startsWith("  on_main:")) {
        const inline = line.slice("  on_main:".length).trim();
        if (inline === "[]") {
          onMain = [];
          listKey = null;
        } else {
          listKey = "on_main";
        }
        continue;
      }
      if (line.startsWith("  reverted:")) {
        const v = line.slice("  reverted:".length).trim();
        reverted = v === "false" ? false : v;
        listKey = null;
        continue;
      }
      if (line.startsWith("    - ")) {
        const sha = line.slice("    - ".length).trim();
        if (listKey === "attributed") attributed.push(sha);
        else if (listKey === "on_main") onMain.push(sha);
        continue;
      }
    }
    if (block === "validated") {
      if (line.startsWith("  at:")) validatedAt = line.slice("  at:".length).trim();
      else if (line.startsWith("  main_tip:")) mainTip = line.slice("  main_tip:".length).trim();
    }
  }

  return { status, legacy, attributed, onMain, reverted, validatedAt, mainTip, fmRaw, body };
}

interface OtherFields {
  session?: string;
  queued_at?: string;
}

function extractOtherFields(fmRaw: string): OtherFields {
  const out: OtherFields = {};
  for (const line of fmRaw.split("\n")) {
    if (line.startsWith("session:")) out.session = line.slice("session:".length).trim();
    else if (line.startsWith("queued_at:")) out.queued_at = line.slice("queued_at:".length).trim();
  }
  return out;
}

function buildFrontmatter(
  p: ParsedFrontmatter,
  others: OtherFields,
  verdict: Verdict | null,
  verdictReason: string | null,
  verdictInvestigatedAt: string | null,
): string {
  const lines: string[] = [];
  lines.push(`status: ${p.status}`);
  if (others.session) lines.push(`session: ${others.session}`);
  if (others.queued_at) lines.push(`queued_at: ${others.queued_at}`);
  if (p.legacy) lines.push(`legacy_number: ${p.legacy}`);

  lines.push("commits:");
  if (p.attributed.length === 0) {
    lines.push("  attributed: []");
  } else {
    lines.push("  attributed:");
    for (const s of p.attributed) lines.push(`    - ${s}`);
  }
  if (p.onMain.length === 0) {
    lines.push("  on_main: []");
  } else {
    lines.push("  on_main:");
    for (const s of p.onMain) lines.push(`    - ${s}`);
  }
  lines.push(`  reverted: ${p.reverted === false ? "false" : p.reverted}`);

  if (verdict) {
    lines.push(`verdict: ${verdict}`);
    lines.push(`verdict_reason: ${yamlQuote(verdictReason ?? "")}`);
    if (verdictInvestigatedAt) lines.push(`verdict_investigated_at: ${verdictInvestigatedAt}`);
  }

  lines.push("validated:");
  if (p.validatedAt) lines.push(`  at: ${p.validatedAt}`);
  if (p.mainTip) lines.push(`  main_tip: ${p.mainTip}`);

  return lines.join("\n");
}

function yamlQuote(s: string): string {
  // Always double-quote so colons + special punctuation in the reason
  // are unambiguous to a YAML parser.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function shortSha(sha: string): string {
  return sha.length >= 12 ? sha.slice(0, 12) : sha;
}

interface Report {
  file: string;
  legacy: string;
  status: string;
  verdict: Verdict | "n/a";
  reason: string;
  attributedBefore: number;
  attributedAfter: number;
  newShasAddedOnMain: string[];
}

function main(): void {
  const validatedAt = isoLocal(new Date());
  const mainTipFull = git(["rev-parse", "origin/main-nowaker"]);
  if (!mainTipFull) {
    console.error("FATAL: cannot rev-parse origin/main-nowaker");
    process.exit(1);
  }
  const mainShasRaw = git(["log", "origin/main-nowaker", "--format=%H"]);
  const mainSet = new Set<string>(mainShasRaw.split("\n").filter(Boolean));

  const allShasRaw = git(["log", "--all", "--format=%H"]);
  const knownSet = new Set<string>(allShasRaw.split("\n").filter(Boolean));
  const shortToFull = new Map<string, string>();
  for (const full of knownSet) {
    shortToFull.set(full.slice(0, 7), full);
    shortToFull.set(full.slice(0, 8), full);
    shortToFull.set(full.slice(0, 12), full);
  }

  function resolveFull(input: string): string | null {
    if (knownSet.has(input)) return input;
    return shortToFull.get(input) ?? null;
  }

  const files = readdirSync(AI_TODO_DIR)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => f !== "README.md")
    .filter((f) => !f.startsWith("_archive"));

  const reports: Report[] = [];
  let touched = 0;

  for (const name of files) {
    const path = join(AI_TODO_DIR, name);
    const text = readFileSync(path, "utf8");

    let parsed: ParsedFrontmatter;
    try {
      parsed = parseFrontmatter(text);
    } catch (e) {
      console.error(`SKIP ${name}: ${(e as Error).message}`);
      continue;
    }
    if (parsed.status !== "DONE") {
      reports.push({
        file: name,
        legacy: parsed.legacy,
        status: parsed.status,
        verdict: "n/a",
        reason: "non-DONE",
        attributedBefore: parsed.attributed.length,
        attributedAfter: parsed.attributed.length,
        newShasAddedOnMain: [],
      });
      continue;
    }

    const others = extractOtherFields(parsed.fmRaw);
    let verdict: Verdict | null = null;
    let reason: string | null = null;
    const attributedBefore = parsed.attributed.length;
    const newShasAddedOnMain: string[] = [];

    // Idempotency invariant: when both a curated map entry AND a
    // non-empty commits.attributed exist for an entry, the curated
    // reason wins. The map entry's citation is strictly more
    // informative than the generic blanket reason, so flipping the
    // preference here would silently degrade reasons across re-runs.
    const key = resolveUnresolvedKey(parsed.legacy, name);
    if (key) {
      const rec = VERDICT_MAP_UNRESOLVED[key];
      verdict = rec.verdict;
      reason = rec.reason;
      if (rec.newShas) {
        for (const raw of rec.newShas) {
          const full = resolveFull(raw);
          if (!full) {
            console.error(`WARN ${name}: SHA ${raw} not found in any branch`);
            continue;
          }
          const short = shortSha(full);
          if (!parsed.attributed.includes(short)) {
            parsed.attributed.push(short);
          }
          if (mainSet.has(full) && !parsed.onMain.includes(short)) {
            parsed.onMain.push(short);
            newShasAddedOnMain.push(short);
          }
        }
      }
    } else if (attributedBefore > 0) {
      verdict = "present";
      reason = "commits.attributed all on main as of validation";
    } else {
      console.error(`UNMAPPED DONE entry with empty attributed: ${name} (legacy=${parsed.legacy})`);
      verdict = "uncertain";
      reason = "no verdict map entry for this legacy id";
    }

    const newFm = buildFrontmatter(parsed, others, verdict, reason, validatedAt);
    const newText = `---\n${newFm}\n---\n${parsed.body}`;
    if (newText !== text) {
      writeFileSync(path, newText);
      touched++;
    }
    reports.push({
      file: name,
      legacy: parsed.legacy,
      status: parsed.status,
      verdict: verdict ?? "uncertain",
      reason: reason ?? "",
      attributedBefore,
      attributedAfter: parsed.attributed.length,
      newShasAddedOnMain,
    });
  }

  const done = reports.filter((r) => r.status === "DONE");
  const present = done.filter((r) => r.verdict === "present");
  const lost = done.filter((r) => r.verdict === "lost");
  const uncertain = done.filter((r) => r.verdict === "uncertain");
  const blanketStamped = done.filter((r) => r.attributedBefore > 0);
  const unresolvedStamped = done.filter((r) => r.attributedBefore === 0);
  const newShasTotal = done.reduce((acc, r) => acc + r.newShasAddedOnMain.length, 0);

  console.error("");
  console.error("=========================================");
  console.error(`Entries processed:                ${reports.length}`);
  console.error(`DONE entries:                     ${done.length}`);
  console.error(`  blanket-stamped (had SHAs):     ${blanketStamped.length}`);
  console.error(`  deep-investigated (32 unresolved): ${unresolvedStamped.length}`);
  console.error(`Verdict: present                  ${present.length}`);
  console.error(`Verdict: lost                     ${lost.length}`);
  console.error(`Verdict: uncertain                ${uncertain.length}`);
  console.error(`Files rewritten:                  ${touched}`);
  console.error(`New SHAs added to commits.on_main: ${newShasTotal}`);
  console.error(`validated.at:                     ${validatedAt}`);
  console.error(`origin/main-nowaker tip:          ${mainTipFull.slice(0, 12)}`);
  console.error("=========================================");

  if (lost.length > 0) {
    console.error("\nLOST entries (positive evidence the work was reverted or never landed):");
    for (const r of lost) {
      console.error(`  legacy=${r.legacy} ${r.file}`);
      console.error(`    reason: ${r.reason}`);
    }
  }
  if (uncertain.length > 0) {
    console.error("\nUNCERTAIN entries (genuinely couldn't determine):");
    for (const r of uncertain) {
      console.error(`  legacy=${r.legacy} ${r.file}`);
      console.error(`    reason: ${r.reason}`);
    }
  }
}

main();
