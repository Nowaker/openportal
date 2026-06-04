---
status: DONE
session: ses_19acecfc9ffeLwGYd7kS56G7wf
queued_at: 2026-05-26T19:48:29-05:00
legacy_number: 80
commits:
  attributed:
    - 08b05e78e937
  on_main:
    - 08b05e78e937
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Todo strip: 9/9-all-done content + popup overflow off right edge

User prompt (verbatim):

> re: todo: this one has: https://portal.desktop.ts.nowaker.net:8443/session/ses_1c35fc059ffemptmpnHZfOGCWX?server=srv-2dy1srwz
> and todoas are misaligned. they overextend beyond the right end of the screen and create a horizonstal scrollbar when todo state is 9/9, all done, and the control.
> even if all is done, 9/9, small todo strip should show the last element on the todo list still.

Two distinct bugs in `apps/web/src/components/todo-strip.tsx`:

1. **9/9-all-done shows no headline**. The strip text was `firstActiveContent = snapshot.todos.find((t) => t.status === "in_progress")?.content` — when no in_progress remains, the headline span doesn't render. Per user spec, the LAST todo's content should fill in instead so the strip stays informative ("9/9 done : Final step description").
   Fix: introduced `headlineContent = firstActiveContent ?? snapshot.todos[snapshot.todos.length - 1]?.content` and swapped the conditional + JSX to read `headlineContent`.

2. **Popup overflows right viewport edge**. The popup's positionStyle (desktop branch) used `left: anchor.left + width: max(anchor.width, 360)`. The header comment at line 167 says "Right-aligned to the strip's right edge so the popup grows leftward from the strip" - but the code did the opposite. With the strip near the viewport's right edge and a 360px min width, the popup extended to the RIGHT past the edge, creating a horizontal scrollbar.
   Fix: switched to `right: max(0, innerWidth - (anchor.left + anchor.width))` so the popup ALIGNS to the strip's right edge, plus `maxWidth: max(280, anchor.left + anchor.width - 16)` so the popup never extends past the viewport's left side either (clamps to available real estate while preserving a sensible minimum).

Affects both desktop (default branch) and mobile branch (mobile branch was already correct - left:5vw right:5vw - the bug was desktop-only).

---
