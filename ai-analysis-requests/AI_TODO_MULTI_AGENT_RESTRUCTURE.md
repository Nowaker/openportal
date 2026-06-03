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
commit: 3adcbb3
session: ses_18572f9a8ffecB57FPahdTEZ4Y
queued_at: 2026-06-03T08:18:12-05:00
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

`commit` is the SHA that landed the work (or empty for PENDING).

`queued_at` is ISO-8601 with timezone — matches the timestamp in the
filename, but kept in frontmatter too for tooling that doesn't want
to parse filenames.

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
