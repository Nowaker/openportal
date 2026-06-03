# `ai-todo/` — the canonical task queue

Each entry is one file. Filename format:

```
<YYYY-MM-DD>_<HH-MM-SS>_<sessionid>_<title-in-dash-case>.md
```

See the canonical rules in `AGENTS.md` under
"`ai-todo/` is the canonical task queue (binding)".

See the design rationale in
`ai-analysis-requests/AI_TODO_MULTI_AGENT_RESTRUCTURE.md`.

## Quick reference

- **Add an entry**: create
  `ai-todo/<now>_<your-session-id>_<short-slug>.md`. Your session
  ID is injected into your context via the user's custom-instructions
  hook — use the value provided, don't introspect.
- **Flip status**: edit one frontmatter line on the entry's file
  (e.g. `status: PENDING` → `status: DONE`, fill `commit: <sha>`).
- **Find an entry**: `ls ai-todo/ | grep <slug>` or
  `ls ai-todo/ | tail -10` for the most recent.
- **All entries as one buffer**: `cat ai-todo/*.md` (skip this
  README first if you want only entries: `cat ai-todo/2*.md`).

## Legacy `#N` references

The repo-root `AI_TODO.md` is gone — its 163 numbered entries were
migrated into this directory by `scripts/migrate-ai-todo.ts`. Each
migrated file carries a `legacy_number:` frontmatter field AND a
`legacy-NNN-` segment in its filename, so existing code comments
like `// per AI_TODO #138` resolve via:

```
ls ai-todo/ | grep legacy-138-
```
