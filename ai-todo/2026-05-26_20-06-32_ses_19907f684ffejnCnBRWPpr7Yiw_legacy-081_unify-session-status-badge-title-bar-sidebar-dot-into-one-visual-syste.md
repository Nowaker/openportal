---
status: DONE
session: ses_19907f684ffejnCnBRWPpr7Yiw
queued_at: 2026-05-26T20:06:32-05:00
legacy_number: 81
commits:
  attributed:
    - 8f1cfa2d8970
  on_main:
    - 8f1cfa2d8970
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Unify session-status badge (title bar) + sidebar dot into one visual system; redo colors so every state is distinguishable; "done / review needed" becomes GREEN

User prompt (verbatim):

> [the docs page describing the existing system]
> [...]
> we need to redo the colors. first big title level badges colors must match sidebar badges. for all i care, they should be the same.  a badge has its still and long form. small goes into pins or tree. large goes into session title when opened in the view.
> they should be unified, and we should show small and large badge for each.
>
> then colors need to be easily distingushible from each other. these three are basically the same to my eye!
> A subagent is running, OR a subsession of this top-level session is running. Violet keeps the parent + child running state visually continuous.
> Subagent in retry state. Same as amber-600 but for subagents.
> Task complete - review needed. Violet steady (no pulse) means the session finished while you weren't looking; the dot clears the moment you open the session.
> ...and they match the color of compacting.
>
> done / needs your review should be green.
>
> buiid on a worktree, remember about agents.md and ai todo.md, merge to main branch when done

Design notes:
- Two parallel implementations collapsed into one:
  - **Old badge logic** lived in `apps/web/src/components/session-status-badge.tsx` with `pickBadge()` and used semantic tokens (`bg-danger`, `bg-warning`, `bg-muted`) mixed with raw Tailwind (`bg-sky-500`, `bg-violet-500`).
  - **Old sidebar dot** lived in `apps/web/src/lib/session-indicators.tsx` `SessionStatusDot()` with raw Tailwind only.
  - They drifted: compacting badge + subagent-busy dot + child-busy dot + review-needed dot ALL landed on `bg-violet-500`. Visually indistinguishable.
- New shared module split into two files so bun unit tests can run without `react/jsx-dev-runtime`:
  - `apps/web/src/lib/session-status.ts` (NEW, pure logic): `StatusKind` union of 11 states, `STATUS_VISUALS` color map, `STATUS_DEFAULTS` labels/tooltips, `pickBadgeStatus(state)` for title-bar input, `pickSidebarStatus(input)` for sidebar tree-aggregated input, `STATUS_SHOWCASE_ORDER` enumeration.
  - `apps/web/src/lib/session-status-render.tsx` (NEW, JSX): `<StatusDot>`, `<StatusBadge>`, `<StatusIndicator size>` rendering primitives.
- Existing callers keep their external API; `SessionStatusBadge` and `SessionStatusDot` are now thin wrappers around the shared system. Zero call-site changes.
- Color palette (every distinct state has its own hue; intentional pairs share label-only):
  - error: `bg-red-500` solid
  - stuck: `bg-red-500` pulsing
  - question: `bg-sky-500` pulsing
  - permission: `bg-sky-500` pulsing (same family as question - both "needs your input"; label disambiguates)
  - compacting: `bg-fuchsia-500` pulsing **(was violet-500 - moved off violet)**
  - tool: `bg-amber-500` pulsing
  - thinking: `bg-amber-500` pulsing (same family as tool; label disambiguates)
  - retry: `bg-orange-600` solid **(was amber-600 / violet-600 - moved to orange so it's not a darker shade of busy amber)**
  - subagent-busy: `bg-violet-500` pulsing (keeps parent/child running visually continuous)
  - queued: `bg-slate-400` solid
  - review-needed: `bg-emerald-500` solid **(was violet-500 - now GREEN per user spec)**
- Pre-existing test infra bug fixed as a side effect: `session-status-badge.test.ts` used to fail at module load with `Cannot find module 'react/jsx-dev-runtime'` because it imported `pickBadge` from the `.tsx` badge component file (which forced JSX evaluation). Split into pure `.ts` (`session-status.ts`) + JSX `.tsx` (`session-status-render.tsx`) so the test now imports `pickBadgeStatus as pickBadge` from the pure module. 16 tests pass.
- Worktree: `~/projekty/webapps/portal-unified-status-badges`, branch `unified-status-badges` off `main-nowaker`. Built + visually verified on `bash scripts/run-worktree.sh 5210` before merging.
- Deploy via `scripts/deploy.sh` (dev-first -> prod) after merge to `main-nowaker`. Push both `origin` (gitlab) and `github`.
- File inventory:
  - NEW `apps/web/src/lib/session-status.ts`
  - NEW `apps/web/src/lib/session-status-render.tsx`
  - MOD `apps/web/src/components/session-status-badge.tsx` (shrunk: 216 -> ~115 lines)
  - MOD `apps/web/src/lib/session-indicators.tsx` (SessionStatusDot shrunk: ~100 lines -> ~40 lines)
  - MOD `apps/web/src/components/session-status-badge.test.ts` (16 passing tests, was 0/1 due to JSX runtime issue)

---

## [Q4] SESSION_WEDGED_BANNER decision (DONE - option 2 chosen by user; shipped 2026-05-26)

User pick (verbatim, msg this turn):

> Invert priority: plugin verdicts override the local heuristic when both fire
> this is good idea.

Implementation in `routes/_app/session/$id.tsx:5610-5644`: the conditional swapped to render `StuckBanner` (plugin verdict) FIRST when `sessionIndicator?.stuck_verdict === "stuck"` is true; the local "Session may be wedged" banner only renders when no plugin verdict says stuck AND the local `stallVerdict === "stuck-busy"`. Ternary chain: `plugin-stuck ? <StuckBanner/> : local-stuck-busy ? <local-banner/> : null`. The dead `stallVerdict === null` guard on the old StuckBanner branch was removed in the same commit.

Original analysis preserved at `ai-analysis-requests/SESSION_WEDGED_BANNER.md`.

4 options that were on the table:
1. Drop the local heuristic entirely; rely solely on stuck-detector plugin verdicts.
2. **Invert priority: plugin verdicts override the local heuristic when both fire. ← USER PICKED**
3. Raise the threshold (5min → 15min) to reduce false-positives on legitimately-slow operations.
4. Add a streaming-delta probe: only fire the banner if NO streaming bytes received in the last N seconds.
