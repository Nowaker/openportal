# AI_TODO restructure for multi-agent / multi-branch safety

## Problem

`AI_TODO.md` is a single ~4100-line file that every agent appends to. In a
multi-agent workflow (one agent per worktree, all sharing the same git
repo on disk) this produces:

1. **Append-point conflicts.** Two agents append at the end of the file
   in parallel. Even when both diffs are pure appends, git's three-way
   merge often flags them as a textual conflict because both target the
   same "EOF" anchor with no intervening unchanged context. Today's
   incident: while merging the `feat/load-first-and-last` branch into
   `main-nowaker`, another agent's uncommitted `### 174. Browser smoke
   check` block sat unstaged in the working tree against my own incoming
   `### 175.` block — `git stash pop` produced a `UU AI_TODO.md` that
   had to be resolved by hand.
2. **Duplicate numbering races.** Both agents independently compute "max
   existing N + 1" and pick the same N. The repo has shipped duplicate-
   number pairs (`#171` appeared twice; #174 appeared twice in today's
   incident). The "loser bumps to N+1" rule depends on someone noticing.
3. **Risk of clobbering uncommitted work.** Any operation that writes
   `AI_TODO.md` (a merge that touches it, a stash pop, even a `git
   checkout` against a branch with a different version) can shadow
   another agent's unstaged work. The global rule "NEVER REVERT WORK
   YOU DID NOT MAKE" then forces a multi-step rescue (stash → merge →
   pop → resolve markers → drop stash → resume).
4. **Operational overhead.** The current AGENTS.md "Safe diffs" +
   "Temp-file fallback" subsections exist solely to work around the
   shared-write-target problem. They're ~70 lines of rules just to
   manage one file.

## Goal

Eliminate the shared write target. Every new entry should land as a
new file at a path no other agent can collide with, AND a status flip
(PENDING → DONE) should touch exactly one file with a one-line diff.

## Proposed structure

`ai-todo/<YYYY-MM-DD>_<HH-MM-SS>_<sessionid>_<title-in-dash-case>.md`

Example:

```
ai-todo/2026-06-03_08-18-12_ses_18572f9a8ffecB57FPahdTEZ4Y_load-first-and-last.md
ai-todo/2026-06-03_22-30-01_ses_b7c2fa4c2e9d_browser-smoke-check.md
ai-todo/2026-06-04_09-11-44_ses_19acecfc9ffeLwGYd7kS56G7wf_btw-render-fix.md
```

### Filename components

- `YYYY-MM-DD_HH-MM-SS` — wall-clock timestamp at the moment the entry
  is created. Underscore separators (not colons) so the path is safe on
  every filesystem. Provides natural chronological sort: `ls ai-todo/`
  shows entries oldest-first, `ls ai-todo/ | tail -10` shows the most
  recent ten.
- `sessionid` — the opencode session ID of the agent that created the
  entry (`ses_...`). Injected into the agent's context via the user's
  custom-instructions hook, so every agent knows its own ID at runtime.
  Guarantees uniqueness even when two agents create an entry in the
  same second (they'd be different sessions, so different IDs).
- `title-in-dash-case` — short kebab-case summary of what the entry is
  about. Human-readable, greppable, mirrors the old `### N. Title`
  heading.

### Why this format eliminates every failure mode

| Failure mode (today) | Why this design fixes it |
|---|---|
| Append-point conflict on AI_TODO.md | No shared write target — each agent writes its OWN file |
| Duplicate numbering race | No number — collision impossible (timestamp + sessionid + slug is globally unique) |
| Stash-pop clobbering other agent's WIP | Other agent's WIP is its own file under `ai-todo/<their-stamp>_<their-id>_<their-slug>.md`. A merge that adds your file cannot touch theirs. |
| Safe-diffs + temp-file fallback rules | Both become unnecessary. The entire ~70 lines of operational rules collapse to one paragraph. |
| Status flip (PENDING → DONE) | Edit one line in one tiny file. Single-file diff cannot conflict with another agent unless they're editing the exact same entry's status — which is fine and merges cleanly. |

### File contents

Each entry file uses YAML frontmatter for machine-readable status,
followed by the same body content the legacy `### N.` heading had:

```markdown
---
status: DONE
session: ses_18572f9a8ffecB57FPahdTEZ4Y
queued_at: 2026-06-03T08:18:12-05:00
legacy_number: 175
commits:
  attributed:
    - 3adcbb3cbd79
  on_main:
    - 3adcbb3cbd79
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Always render original prompt + last N messages

User prompt (verbatim):

> when loading session in openportal, it should always load its original user prompt AND last x messages...

Design notes:

- Server: `?first=1` endpoint...
- Client hook: `useFirstSessionMessage`...
- Route: ...
```

Status values: `PENDING`, `IN_PROGRESS`, `DONE`, `Q-DEFERRED`,
`CANCELLED` (same vocabulary as today).

`queued_at` is ISO-8601 with timezone — matches the timestamp in the
filename, but kept in frontmatter too for tooling that doesn't want
to parse filenames.

`commits` + `validated` blocks replace the older flat `commit: <sha>`
single-field form. Schema, rationale, and audit workflow are in the
"Commit tracking + validation metadata" section below.

## Numbering and references

The legacy `#142` / `#138` shorthand goes away. New cross-references
use the slug (the readable part of the filename):

- Code comment today: `// per AI_TODO #138: openportal forks the parent`
- Code comment going forward: `// per ai-todo/...btw-side-question.md` or
  just `// per ai-todo "btw side question"` (any unique substring of
  the slug is greppable).

Existing `// AI_TODO #138` comments in the codebase stay valid as
historical references — `AI_TODO.md` is preserved frozen alongside
the new directory, so anyone curious can still look up #138.

## Migration plan (executed)

The user chose the full split. `scripts/migrate-ai-todo.ts` (Bun) reads
`AI_TODO.md`, splits at `^### N\. ` boundaries, and writes each entry
as a standalone file under `ai-todo/`. The script's matching strategy:

1. **Parse each entry** for its title, status parens, and verbatim user
   prompt block. The header regex matches `User prompt`, `User prompts`,
   `User-provided`, and `Follow-up user prompt` variants.
2. **Pre-cache** every `role=='user'` text part from
   `~/.local/share/opencode/opencode.db` into memory (~15K rows).
3. **Match** the prompt against the cache using a layered candidate set:
   prefix slices at 30/50/80/150 chars, prefix-stripped slices that drop
   common AI annotations (`Enqueue:`, `enqueue to end:`, `after done:`,
   `H:`), mid-prompt offset slices, tail slices, and a whole-prompt
   slice for short entries. First substring hit wins, ordered by
   message `time_created` ascending so the earliest occurrence is used.
4. **Filename**:
   `ai-todo/<YYYY-MM-DD>_<HH-MM-SS>_<sessionid>_legacy-NNN_<slug>.md`
   in this machine's local timezone (`-05:00`). The `legacy-NNN`
   segment preserves the original number so old `// per AI_TODO #138`
   references resolve via `ls ai-todo/ | grep legacy-138-`.
5. **Frontmatter**: `status`, `commit` (SHA extracted from
   `(DONE - <sha>...)` parens when present), `session`, `queued_at`,
   `legacy_number`. Body content is preserved byte-for-byte from the
   legacy entry minus its `### N.` heading line.
6. **Fallback**: entries whose prompt doesn't match anything in
   opencode.db (synthesized/paraphrased prompts, empty bodies, too-
   generic two-word prompts) get `session: ses_unknown` and a
   synthetic timestamp at `2024-01-01 00:00:00 + N seconds` so the
   files still sort by original entry number.
7. **Preamble preserved**: the leading non-numbered sections of
   `AI_TODO.md` (EXPLICIT CANCELLATIONS, STANDING RULES, COMPLETED
   THEMES) are archived to `ai-todo/_archive-legacy-preamble.md`.
8. **`AI_TODO.md` deleted** after migration. Cross-references in code
   comments resolve via `legacy_number` instead.

Result on the migration run: 158/163 entries matched a real opencode
session ID and datetime. 5 fell back to `ses_unknown` (`#57`, `#129`,
`#130`, `#137`, `#149`) — these were either empty-body section
headers, synthesized multi-part dispatch summaries, or prompts so
short ("still wrong") they'd have thousands of false-positive
matches and aren't worth a lookup.

The script is committed at `scripts/migrate-ai-todo.ts` for
reproducibility; it can be re-run end-to-end against the same
`AI_TODO.md` content to regenerate the directory.

## Commit tracking + validation metadata

Past projects have shipped DONE entries whose recorded SHA later
disappeared from `main-nowaker` via force-reset, revert, or rebase
chain — and the only proof of vanished work was a stale frontmatter
field. The single-SHA `commit:` form silently masked the rewrite. The
`commits:` + `validated:` blocks fix that by recording (a) every SHA
ever attributed and (b) which of them are still on main as of a
specific snapshot.

### Schema

```yaml
commits:
  attributed:        # 12-char SHAs (full audit trail)
    - 3adcbb3cbd79
    - 5c48ab8e8200  # original SHA that got force-reset/rebased into 3adcbb3, kept for forensics
  on_main:           # subset of `attributed` currently present on origin/main-nowaker
    - 3adcbb3cbd79
  reverted: false    # OR: 12-char SHA of the revert / drop commit when work was undone
validated:
  at: 2026-06-03T19:06:51-05:00   # ISO-8601 timestamp at which on_main was computed
  main_tip: a30d45b0f729           # 12-char SHA of origin/main-nowaker at validation time
```

Field semantics:

- `commits.attributed` — append-only list. New SHAs land at the
  end. Original SHAs are kept even after a rebase rewrites them,
  so a reviewer can see exactly what changed and when.
- `commits.on_main` — the intersection of `attributed` with the
  ancestry of `origin/main-nowaker` at validation time. Computed
  with `git merge-base --is-ancestor <attributed-sha>
  origin/main-nowaker`. Empty `on_main` on a DONE entry is a flag
  ("did the work get dropped?").
- `commits.reverted` — `false` when no revert was found; the
  12-char SHA of a `Revert "..." <attributed-sha>` commit otherwise.
  Distinguishes "feature deliberately rolled back" (reverted has a
  SHA) from "history rewritten" (`on_main` empty, `reverted: false`).
- `validated.at` — ISO-8601 with the project's `-05:00` offset.
- `validated.main_tip` — 12-char SHA of `origin/main-nowaker` at
  validation time. Lets a reviewer reproduce the verdict:
  `git merge-base --is-ancestor <attributed-sha> <main_tip>`.

### Discovery rules used by `scripts/enrich-ai-todo.ts`

The script populates `commits.attributed` for every entry, in
priority order:

1. **Explicit SHA in existing frontmatter.** If the entry came
   from the migration with a `commit: <sha>` field, that SHA is
   adopted verbatim (expanded to 12 chars via `git rev-parse`).
2. **Topic search by title keywords** — only for `status: DONE`
   entries with no explicit commit. Distinctive tokens are
   extracted from the `# Title` heading; a commit is attributed
   only when EXACTLY ONE subject across all branches contains
   every keyword AND its author date falls within
   `queued_at + [-2d, +14d]`. Conservative on purpose: ambiguous
   matches are rejected, no entry is fabricated.
3. **Nothing else.** If neither rule lands a SHA, the script
   writes `commits.attributed: []` and `commits.reverted: false`.
   No guessing.

`commits.on_main` is set from in-memory ancestry: the script
caches `git log origin/main-nowaker --format=%H` once at startup
and intersects each attributed SHA with that set.

`commits.reverted` is set from a single pre-computed map: every
subject on main matching `/Revert.*\b([a-f0-9]{7,40})\b/` is
indexed by its referenced short SHA. Attributed SHAs missing from
`on_main` are then looked up in this map.

`validated.at` is captured ONCE at the start of the run and
applied to every file, so the snapshot is internally consistent —
the reviewer can re-derive every `on_main` value from the same
git state the agent saw. `validated.main_tip` is captured the
same way.

### Audit workflow

After a major rebase, force-reset of `main-nowaker`, or any time
the integrity of past DONE entries needs verification:

```bash
cd ~/projekty/webapps/portal-ai-todo-restructure
git fetch origin main-nowaker
bun scripts/enrich-ai-todo.ts
```

The script prints three flags worth a human's attention:

1. **DONE + attributed but no on_main** — the work was attributed
   to a SHA that no longer reaches main. Either a force-reset
   wiped it (cross-check via `git reflog`) or the SHA itself got
   rewritten into a different commit on main (cross-check by
   subject-line grep). Update the entry by appending the new SHA
   to `commits.attributed` so the original is preserved.
2. **Reverted (true)** — a revert commit was found targeting an
   attributed SHA. The work is no longer live. Decide whether to
   re-queue (new PENDING entry referencing the original) or
   accept the rollback.
3. **DONE + attributed empty** — entries with no SHA recorded at
   all. Mostly historical baggage from the legacy migration; the
   user can fill these in manually with `git log -S '<distinctive
   code>'` if any DONE entry's exact landing SHA is worth
   recovering.

Commit the enriched files atomically with subject
`ai-todo: re-validate against origin/main-nowaker tip <main_tip>`
so history shows when the audit ran.

### Why two blocks instead of one

Splitting `commits` (what shipped) from `validated` (when it was
checked) is deliberate:

- `commits.*` is immutable history — append-only attribution and
  the latest verdict on landing. A reviewer reading an old entry
  sees what was true when the last audit ran.
- `validated.*` is a snapshot timestamp. Two entries can both
  claim `on_main: [<sha>]` but if their `validated.main_tip`
  differs, they were checked against different states of the
  world. The audit timestamp is part of the claim.

Flat `commit: <sha>` had neither property: no audit trail of
rewrites, no snapshot of when the field was last true.

### Verdict + investigation metadata

The enrichment pass conservatively attributes a SHA only when an
explicit `commit:` field carried over from the migration OR a
title-keyword topic search lands EXACTLY one matching subject in
the right time window. That leaves a long tail of DONE entries
with `commits.attributed: []` — work the user knows shipped but
that the heuristic couldn't pin to a commit. The verdict pass
turns those empty rows into a positive cited claim.

`scripts/verdict-ai-todo.ts` stamps three additional fields on
every DONE entry, written between the `commits:` and `validated:`
blocks:

```yaml
verdict: present                                       # OR: lost | uncertain
verdict_reason: "Component X at apps/web/.../foo.tsx:123"  # ALWAYS cited
verdict_investigated_at: 2026-06-03T19:51:00-05:00
```

Field semantics:

- `verdict` — three values:
  - `present` — the work is verifiably in today's codebase
    (file:line anchor found via `rg`) OR an attributed SHA is on
    `origin/main-nowaker`.
  - `lost` — positive evidence the work was reverted (revert
    commit found), force-reset away (SHA exists in history but
    not on main and no revert), or shipped only to a stale
    branch that never merged. The user's real concern: the verdict
    pass surfaces these prominently in the script's summary.
  - `uncertain` — last resort. The four-step investigation
    (codebase grep, git pickaxe, session-grep, ancestry) yielded
    nothing conclusive. Try not to use this; exhaust the other
    paths first.
- `verdict_reason` — ALWAYS cite a specific anchor. Good shapes:
  `"Component X at apps/web/.../foo.tsx:123"`, `"Commit abc1234 on
  main: 'subject line'"`, `"Session ses_XXX msg_YYY shows AI
  announced 'shipped: <sha>' but sha not on any branch — reverted"`.
  Bad shape: `"investigated"` (uncited; worthless).
- `verdict_investigated_at` — ISO-8601 timestamp at which the
  verdict was reasoned about. Distinct from `validated.at` because
  validation just intersects SHAs with main, whereas the verdict
  involves real investigation — re-running the verdict script
  applies the curated map plus a fresh blanket pass over
  already-attributed entries.

Two-pass design (matches the script):

1. **99 DONE entries that already carry `commits.attributed` SHAs.**
   Trivially stamped `verdict: present` with reason
   `"commits.attributed all on main as of validation"`. No
   investigation needed — the enrichment pass already proved
   ancestry.
2. **32 DONE entries with empty `commits.attributed: []`.**
   Investigated by hand using a four-step methodology, then
   stamped via a curated map embedded in
   `scripts/verdict-ai-todo.ts` (`VERDICT_MAP_UNRESOLVED`):
   1. **Extract clues** from the entry body: title keywords,
      file paths in `Design notes:`, function/component names, UI
      strings, API endpoint paths, config keys, the
      `session:` ID, and the `queued_at:` timestamp.
   2. **Codebase verification (primary signal).** `rg -F
      '<distinctive identifier>' apps/web/src/` against HEAD. If
      any clue resolves to live code, the work is present.
   3. **Git history forensics.** `git log --all --grep` / `git
      log --pickaxe-regex -S` for the distinctive identifier;
      `git merge-base --is-ancestor <sha> origin/main-nowaker`
      to verify on-main; subject-grep for `Revert "..."
      <attributed-sha>` to surface reverts.
   4. **Session forensics via
      `~/projekty/nowaker/opencode-tools/session-grep.ts`.** For
      operational entries (smoke tests, branch unprotect, recovery
      handoffs) where no code commit is expected, the session
      breadcrumb (assistant announcing a SHA, user confirming
      "shipped", tool calls writing specific files) is the
      durable artefact.

When a new commit SHA is discovered during the investigation it
is appended to `commits.attributed` AND (when on main)
`commits.on_main`. The enrichment pass was conservative; the
verdict pass digs harder, so previously-empty rows can pick up
real attribution after a verdict run.

### Audit workflow for verdicts

After a major rebase, force-reset of `main-nowaker`, or any time
the integrity of past DONE verdicts needs re-verification:

```bash
cd ~/projekty/webapps/portal-ai-todo-restructure
git fetch origin main-nowaker
bun scripts/enrich-ai-todo.ts   # refresh commits.on_main / reverted / validated.*
bun scripts/verdict-ai-todo.ts  # re-stamp verdicts against the new ancestry
```

The verdict script prints a summary including:

- Total DONE entries processed and how many were blanket-stamped
  vs deep-investigated.
- `verdict: present` count.
- `verdict: lost` count + the actual list (path + reason). These
  are the user's real concern — surfaced prominently.
- `verdict: uncertain` count + the actual list.
- New SHAs added to `commits.on_main` during the run.

Commit the re-stamped files atomically with subject
`ai-todo: re-stamp verdicts against origin/main-nowaker tip <main_tip>`
so history shows when the re-audit ran.

## Commit message convention

- Today: `AI_TODO.md: <subject>` for entry-only commits.
- Going forward: `ai-todo: <subject>` for entry-only commits (path is
  now a directory). Code commits that include an entry inline mention
  `ai-todo: ...` in the body.

## Tooling (optional)

None of the following is required for the new scheme to work — they're
quality-of-life helpers an agent or human can use if they want.

- `scripts/ai-todo-add.sh "<short title>"` — generates a fresh entry
  file with the current timestamp + the agent's session ID + a slug
  derived from the title. Pre-fills the frontmatter so the agent just
  has to paste the user prompt and design notes.
- `scripts/ai-todo-render.sh` — concatenates `ai-todo/*.md` sorted by
  filename into a single rendered view, mimicking the legacy
  `AI_TODO.md` shape. Useful when an agent wants the whole queue in
  one buffer. Output is not committed (could be gitignored under
  `ai-todo/rendered.md` or printed to stdout).
- `scripts/ai-todo-list.sh [PENDING|DONE|...]` — lists entries by
  status, reading frontmatter.

The session-ID injection (via the user's custom-instructions hook) is
the only piece that has to land BEFORE this scheme is usable. Without
it, agents can't fill the `sessionid` slot deterministically.

## AGENTS.md changes (preview)

The existing section `## AI_TODO.md is the canonical task queue
(binding)` (~100 lines, includes "Safe diffs" and "Temp-file
fallback" subsections) is replaced with a shorter section. See the
companion AGENTS.md edit in this branch for the full text. Summary:

- Format spec: filename, frontmatter, body
- Status discipline: same vocabulary, edits go in frontmatter
- Append-only by file (never edit shipped files except status flip
  or DONE-commit-SHA fill-in)
- "Safe diffs" subsection: deleted. No longer relevant.
- "Temp-file fallback" subsection: deleted. No longer relevant.
- `.gitignore` entry for `AI_TODO_*_ses_*.md` legacy temp files:
  optionally removed (safe to keep as defensive).

## Trade-offs

**Pro:**
- Zero shared write target → zero merge friction between concurrent agents
- Status flips are one-line one-file diffs → trivially mergeable
- AGENTS.md operational rules shrink ~70 lines
- File-system-native sort (no manual numbering)
- Each entry's filename is self-documenting (when, who, what)

**Con:**
- ~190 individual files in `ai-todo/` instead of one big file (cheap, but
  affects `git log -p` size — not a real concern)
- Legacy `#N` shorthand only works against the frozen `AI_TODO.md`;
  new entries don't have N. Cross-refs become slug-based. Slightly
  longer to write, but greppable.
- Filenames are long (~100 chars). Cosmetic; doesn't break anything.
- Requires the session-ID injection hook to be in place. Until then,
  agents can use `unknown` as a sessionid placeholder.

## Decision points the user should weigh in on

1. **Option A (freeze legacy) vs Option B (full split)?** I recommend A.
2. **Session ID format in filename: raw `ses_XXX` vs short prefix
   `ses_XXX[:12]`?** Recommend full ID — longer but unambiguous.
3. **Should `ai-todo-add.sh` helper land in this MR, or stay an
   optional follow-up?** I'd defer it; the scheme works without it,
   and the helper depends on the session-ID hook being live.
4. **Should we re-purpose the existing `### N. Title` heading as the
   `<h1>` inside each entry file?** Recommend yes — preserves
   continuity, makes legacy references easier to migrate manually if
   anyone wants to.
