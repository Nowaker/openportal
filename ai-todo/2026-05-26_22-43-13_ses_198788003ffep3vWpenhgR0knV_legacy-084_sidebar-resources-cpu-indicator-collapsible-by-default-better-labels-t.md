---
status: DONE
session: ses_198788003ffep3vWpenhgR0knV
queued_at: 2026-05-26T22:43:13-05:00
legacy_number: 84
commits:
  attributed:
    - e03e83609c2d
  on_main:
    - e03e83609c2d
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Sidebar resources/CPU indicator: collapsible by default, better labels, two-view layout

User prompt (verbatim):

> CPU/resources indicator in left navbar.
> Both on desktop and mobile, by default, show a collapsed, minimized view of the indicator. Just like a row of todo gives an idea on progress of everything, this minimal component should too.
> Make it horizontal to occupy all space. Flex to put as many components as possible but without making them shrink to the point where they are useless, just hide lower priority ones. Each component top line name, eg cpu, mem, spc, lat, acronyms/shorts like that. Bottom line 50%, 3s, etc. On the very right ^ to expand it to full size. When expanded in full size (current situation), opposite of ^ to collapse.
>
> CPU in full mode: current: 11%. Expected: 11% (of x cores)
>
> This oc, cohort x2, all ocs, I hate these labels, improve them.
>
> Sse should be sse latency or something like that (and consistent with how other oc metrics are named/presented)
>
> other ocs×1 maybe be irrelevant, we can drop it.
>
> For the full view maybe we could try making it a grid of 2 columns (two metrics per column) or more, depending on space available. In full mode, we want each component to be like:
> ```
> Metric name                 value
> -------------------> %bar if applies
> ```
> Let's give it all a try.

Design notes:

- Two view modes for `apps/web/src/components/sidebar-system-stats.tsx`:
  - **Collapsed (default)**: single horizontal row. Each cell is two lines (top: 3-letter acronym `CPU`/`MEM`/`SPC`/`LAT`/`IOW`/`OC`/`COH`; bottom: short value `11%`/`3s`). Cells flex to natural width with a min-width floor (~52px). When the container is too narrow, lower-priority cells are hidden in priority order (CPU > MEM > SPC > LAT > IOW > OC > COH > OCS). Chevron at the right edge (`^`) toggles to expanded.
  - **Expanded**: 2-column grid. Each cell: header row with label (left) + value (right), optional %bar below, optional subtitle/detail line for secondary info. Chevron at bottom-right (`v`) toggles back to collapsed.
- Persisted in a new localStorage-backed zustand store `apps/web/src/stores/sidebar-stats-expand-store.ts` (`expanded: boolean`, default `false`). Per-browser UI preference — matches the pattern of `font-size-store.ts`/`sidebar-expand-store.ts`. Not URL-driven (it's a persistent widget mode, not navigable state).
- Label improvements:
  - `cpu` -> `CPU` (full) / `CPU` (acronym)
  - `ram` -> `Memory` / `MEM`
  - `iowait` -> `I/O wait` / `IOW`
  - `disk` -> `Disk` / `SPC` (with optional path suffix when multiple disks)
  - `this oc` -> `Active OpenCode` (full) / `OC` (acronym)
  - `cohort×N` -> `Cohort (×N)` / `COH`
  - `all ocs×N` -> `OpenCodes on host (×N)` / `OCS`
  - `sse` -> `SSE latency` / `LAT`
  - `other ocs×N` row: **dropped entirely** per user.
- CPU expanded view: value column shows current `totalPercent`; subtitle line shows `expected X% (of N cores)` derived from `stats.load.one / navigator.hardwareConcurrency * 100`. Both surfaces visible only in expanded; collapsed shows just current `totalPercent`.
- Fixed a latent bug: the `all ocs (host fallback)` row was gated on an impossible `cohortProcesses.length === 0 && otherProcesses.length === 0 && stats.opencodeProcesses.length > 0` (otherProcesses is the complement of cohortProcesses — their lengths cannot both be 0 when total > 0). New gating: show host-fallback when `!cohort.pluginReachable && stats.opencodeProcesses.length > 0`. Correctly surfaces the host-total row when the cohort plugin is unreachable.
- Implementation detail for collapsed-overflow: render all cells, use ResizeObserver on the row, compute fit-count from container width using a fixed-cell-width assumption (cells are roughly uniform — 3-char acronym + 3-4 char value). Apply slice-based `display: none` to overflow cells. Always keep at least 1 cell visible.
- Preserve existing `data-test="portal-sidebar-system-stats"` + `data-test="portal-sidebar-sse-latency"` for any future tests. Add `data-test="portal-sidebar-system-stats-toggle"` on the chevron, `portal-sidebar-stats-cell-<key>` on each collapsed cell, `portal-sidebar-stats-row-<key>` on each expanded row.
- Keep the `in-data-[collapsible=dock]:hidden` wrapper class — when the sidebar is in dock mode, the indicator stays hidden entirely (current behavior preserved).
- Worktree: `~/projekty/webapps/portal-sidebar-resources` (branch `sidebar-resources-indicator`). Originally numbered #83 in the worktree but parallel session committed `a3da5a8` with their own #83 (new-session topbar) before this work landed, so renumbered to #84 during rebase.
