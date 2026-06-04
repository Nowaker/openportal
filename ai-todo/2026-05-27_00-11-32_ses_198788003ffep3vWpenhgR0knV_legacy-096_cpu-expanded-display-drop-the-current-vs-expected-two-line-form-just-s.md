---
status: DONE
session: ses_198788003ffep3vWpenhgR0knV
queued_at: 2026-05-27T00:11:32-05:00
legacy_number: 96
commits:
  attributed:
    - d214ef563858
  on_main:
    - d214ef563858
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# CPU expanded display: drop the "current vs expected" two-line form, just show "X% (of N cores)" as the value

User prompt (verbatim):

> CPU
> 24% (of $nproc cores)

Design notes:

- Follow-up tweak to #84 (sidebar resources indicator redesign). The expanded CPU cell shipped with `value = "24%"` on the right and a separate sub line `"expected 24% (of 20 cores)"` underneath the bar. In practice `current` (`/proc/stat` delta sample) and `expected` (load1/cores) are nearly always equal — two redundant numbers cluttering the cell. User asked to collapse this into a single line where the value column itself reads `"24% (of N cores)"`.
- Implementation in `apps/web/src/components/sidebar-system-stats.tsx`:
  - Removed `expectedCpuPercent` const + the "Expected" / load1-derivation comment block.
  - Removed the CPU metric's `sub` field.
  - Added `expandedValue: \`${pct(cpuPercent)} (of ${cores} core${cores === 1 ? "" : "s"})\`` to the CPU metric. The literal `(of N cores)` annotation now lives in the value column rather than as a separate caption.
  - `cores` keeps reading from `navigator.hardwareConcurrency` (with `Math.max(1, ...)` clamp). Singular/plural handled inline ("1 core" vs "N cores").
- New optional field on `Metric` interface: `expandedValue?: string`. `ExpandedCell` renders `metric.expandedValue ?? metric.value`; `CollapsedCell` still renders `metric.value`. Lets a cell carry richer context in the wider expanded layout without inflating the compact-row cell width. CPU is the only metric that sets it.
- Collapsed view unchanged: CPU cell still shows just "24%" so the horizontal row's fit math (~52px per cell) is preserved.
- Worktree: `~/projekty/webapps/portal-cpu-display` (branch `cpu-display-tweak`). Originally numbered #95 but lost the race to a parallel agent who pushed `0e03d4d` (#95 "chat user prompt bubble tint") to origin first; renumbered to #96 per AGENTS.md "loser bumps to N+1" rule.
