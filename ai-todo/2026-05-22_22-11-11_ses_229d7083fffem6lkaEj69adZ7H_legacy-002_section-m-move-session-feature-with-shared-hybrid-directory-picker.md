---
status: DONE
commit: 
session: ses_229d7083fffem6lkaEj69adZ7H
queued_at: 2026-05-22T22:11:11-05:00
legacy_number: 2
---

# Section M — Move session feature with shared hybrid directory picker

User prompts (synthesized from two messages):

> and yes, i want portal to have move session feature. when clicked from right hamburger, the previously mentioned keyboard friendly file path browser opens.

> ACTUALLY - for both situations - it should be a hybrid of ^K (look up session - where matches show up, and you can arrow up/down them) and open directory (where you can cd into dirs, use tab or arrows), etc. the entries already on the list to filter from should be directories that have at least one project (exact same logic as sidebar navigation tree - REUSE). let's see how you're able to join two conccepts (navigating the tree and filtering existing entries).

Design notes:
- Right hamburger adds "Move to project..." item.
- Hybrid picker filters projects-with-sessions list (= sidebar navigation tree source; do NOT duplicate). Arrow up/down + type-to-filter + Tab/Right to enter sub-trees + Enter to confirm.
- Backend `POST /api/sessions/:id/move-to-project` calls `~/projekty/nowaker/opencode-tools/move-local.ts` (which now has `--target` auto-resolution as of opencode-tools commit `d5902ce`). For v1 can shell out via execFile; library extraction queued separately in opencode-tools.
- Pre-flight `--dry-run` shows what'll move (parent + subagent closure count).
- In-flight refusal handling with explicit override option ("Session has a live runner. Abort first to move, or check 'allow in-flight' (advanced)").
- Multi-phase status: "Validating target...", "Moving session + N subagents...", "Updating on-disk artifacts...", "Done. Refreshing session list..."
