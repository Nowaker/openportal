---
status: DONE
commit: fa08027
session: ses_199227d6cffeTeVJUTbvAI4gmM
queued_at: 2026-05-26T19:37:33-05:00
legacy_number: 77
---

# Left sidebar: consistent 0.75rem indent per level + reduce ambient padding + align pinned buttons

User prompt (verbatim):

> left navbar: look at indentation level increase from subcategory to subcategory, or subcategory to project. this is the right indent.
> then look at project -> session. there is no extra indent, making it hard to distinguish what is a session and what is a project. apply same indent to sessions.
> then look at session -> subsession. the is an extra indent, but larger than it should be. match the "right indent" we established.
>
> also, <div class="col-span-full flex items-center gap-1 pr-3 py-1 rounded hover:bg-muted/20 transition-colors" style="padding-left: 0.75rem;"><button type="button" title="/home/nowaker/projekty/webapps" class="flex flex-1 items-center gap-1 min-w-0 text-left">...</button>...</div> <- from this, remove the extra padding left.
>
> also for this: <div class="col-span-full pt-2 pb-1 px-3 text-[11px] text-muted-fg flex items-center gap-1 min-w-0" title="/home/nowaker/projekty">...</div>
>
> generally all the pinned titles (pinned, ~/projekty, ~//sync/whatever) and items have too much padding left and right (  padding-right: calc(var(--spacing) * 3);)
>
> then even data-slot="sidebar-section" has too much padding. make it calc(var(--spacing)*2) not *4.
>
> make sure that the pinned section has similar paddins as the directory/project tree, so side buttons from pins (like unpin) are aligned with side buttons from the tree (e.g. archive).
>
> implement on a worktree. merge into main branch when done. remember about AI TODO md and project AGENTS md rules.

Design notes:
- Consolidate every left-padding formula in the sidebar tree to one rule: each logical depth step = `0.75rem`. No more `0.5 + depth*0.75` (ProjectGroup) vs `0.75 + depth*0.75` (TreeNodeRow) vs `2rem` (subsession depth=0) vs `calc(headerPaddingLeft + 1.25rem)` (subsession depth>0). All collapse to `depth * 0.75rem` for that row's logical level.
- The three logical levels within a single project are: project header (`depth*0.75rem`), session inside (`(depth+1)*0.75rem`), subsession inside (`(depth+2)*0.75rem`). This finally gives `project → session` a visible +0.75rem step (was 0; root cause: `sessionRowStyle` was set to `headerPaddingLeft` verbatim) and reduces `session → subsession` from +1.25rem to +0.75rem.
- Remove the +0.75rem floor from category/project headers at depth 0. Previously a depth-0 category had `0.75 + 0*0.75 = 0.75rem` inline plus `pr-3`; a depth-0 project had `px-3` (so 0.75rem on BOTH sides). Both now use just `pr-3` with `paddingLeft: 0`. The SidebarSection's outer `p-2` (formerly `p-4`) provides the ambient frame instead.
- `apps/web/src/components/ui/sidebar.tsx:554` — drop the `p-4` from `SidebarSection`. New class is `"in-data-[state=collapsed]:p-2 p-2"`. Halves the section's frame from 1rem to 0.5rem on all four sides; collapsed-state padding already matched.
- `apps/web/src/components/app-sidebar.tsx`:
  - ProjectGroup `headerPaddingLeft` = `${depth * 0.75}rem` (always defined, including depth=0=0rem).
  - ProjectGroup `sessionRowStyle.paddingLeft` = `${(depth + 1) * 0.75}rem` (was `headerPaddingLeft` verbatim).
  - ProjectGroup header div class: replace ``${depth > 0 ? "pr-3" : "px-3"}`` with `"pr-3"`. Always apply `headerStyle`.
  - ProjectGroup session row class: replace ``${depth > 0 ? "pr-3" : "pl-3 pr-3"}`` with `"pr-3"`. Always apply `sessionRowStyle`.
  - ProjectGroup subsession `paddingLeft` = `${(depth + 2) * 0.75}rem` (was `calc(headerPaddingLeft + 1.25rem)` or `2rem`).
  - TreeNodeRow `paddingLeft` (line 1271) = `${depth * 0.75}rem` (was `0.75 + depth*0.75`).
  - TreeChildren "Show N more" button `paddingLeft` (line 1172) = `${rest.depth * 0.75}rem` (was `0.5 + rest.depth*0.75`).
  - WorkspaceHeader (line 885): `px-3` → `pr-3`. The `~/projekty` and `~/sync/...` headers now flush-left within the section so they align with depth=0 category headers below.
  - PinnedSection "Pinned" label (line 941): `px-3` → `pr-3`. Aligns with workspace header.
  - PinnedSection rows container (line 944): drop the `px-1` wrapper — rows themselves now own their padding.
  - PinnedSection row (line 957-961): `px-2 py-1` → `pr-3 py-1` with `paddingLeft: 0.75rem` inline. `pr-3` matches the project tree's right-edge so the unpin button at the end of each pinned row lands at the same x as the archive button at the end of each session row. `paddingLeft: 0.75rem` matches a depth=0 session row's left padding.
  - Pinned row gap: `gap-1.5` → `gap-1` to match session row gap and keep status indicators visually consistent across pinned and tree.
- Verification recipe (after build):
  - `/api/instance/self` returns 200 (smoke).
  - Visually: depth 0 category and depth 0 project both flush at `section_padding=0.5rem` from sidebar edge.
  - Each level deeper: chevron/title shifts right by exactly 0.75rem. Sessions inside a project are 0.75rem to the right of the project header. Subsessions are 0.75rem to the right of the session row.
  - Pinned-section unpin button right-edge x-coordinate = tree-section archive button right-edge x-coordinate (both end at `section_pr=0.5rem + row_pr-3=0.75rem = 1.25rem` from sidebar's right edge).
- Build/merge cycle:
  1. Make changes on `sidebar-padding` branch in worktree at `~/projekty/webapps/portal-sidebar-padding`.
  2. `REBUILD=1 bash scripts/run-worktree.sh 5200` to build + foreground-serve on tailnet:5200.
  3. Visual smoke via playwright in worktree (sidebar screenshot at depth 0/1/2, pinned section visible).
  4. `git merge sidebar-padding` (fast-forward) into `main-nowaker`.
  5. `bash scripts/deploy.sh` (dev-first → prod) from `main-nowaker`.
  6. `git push origin main-nowaker && git push github main-nowaker`.
  7. `git worktree remove ~/projekty/webapps/portal-sidebar-padding && git branch -d sidebar-padding`.
