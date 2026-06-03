---
status: DONE
commit: 2f181c3
session: ses_198124cb5ffeaWVOzvQ1tcjCMY
queued_at: 2026-05-27T00:34:52-05:00
legacy_number: 91
---

# AI message metadata line: agent · model · effort · turn duration on final-answer rows

User prompt (verbatim):

> AI responses in chat log have:
> [icons] 5/26, 22:16
> Or
> [icons] 22:16
>
> Let's also add, in next line, agent name, model name, thinking effort, and total total processing time (nice formatting eg 5m, max two units of time, eg 5m 23s, but 5h 5m not seconds any more, or 1d 5h, and not minutes etc), if this is the final answer from the AI. one that is considered the end.
>
> And while there look at this thing. When a final Ai response is in the output, and nothing is queued afterwards, portal sometimes shows nonsense: Server is idle - prompt accepted but generation never started.
> Resubmit
>
> There's a final response in the chat. The Ai is done. Stuck detector doesn't complain. So Why show this?! Fix this.Git tree, merge after done, deploy, push

Design notes:

- Adds a second line to the per-message bottom-right gutter (the strip that today holds star / fork / revert / copy / info / timestamp). The new line appears ONLY on completed assistant messages — gated by `message.info.role === "assistant" && time.completed > 0`. Streaming / in-flight / failed-without-completed assistants do not get it.
- Each turn in opencode produces exactly one assistant Message that wraps every part (text, reasoning, tool calls). A completed assistant message IS the "final answer" for that turn, matching the user's "one that is considered the end" rubric. Implementation deliberately renders the line on EVERY completed assistant in the chat, not just the latest — historical audit value (what model / effort / duration each turn used) is high and uniform across turns.
- Format spec (one line, monospace, muted, separator " · "):
  - `<agent> · <model display name> · <thinking variant> · <duration>`
  - Any field that is missing / empty is OMITTED (no dashes, no "—" placeholders). Agent comes from `message.info.agent`; variant comes from `message.info.variant`. Model display name resolved via `useProviders()` (`providers[].models[modelID].name`, e.g. raw `claude-opus-4-7` → "Claude Opus 4.7"); falls back to raw ID when the providers cache hasn't hydrated.
  - Title attribute carries the verbose breakdown (newline-separated): `Agent: <agent>` / `Model: <provider> / <modelName>` / `Thinking effort: <variant>` / `Turn duration: <duration>`.
- New duration formatter `formatDuration(ms)` in `apps/web/src/lib/format-time.ts`: max TWO units of granularity from the largest non-zero unit downward. Examples: 45_000 → `45s`; 65_000 → `1m 5s`; 300_000 → `5m`; 3_900_000 → `1h 5m` (no seconds once an hour is present); 90_000_000 → `1d 1h` (no minutes once a day is present); 500 → `<1s`; 0 / negative → `0s`. Matches the user's spec verbatim: "5m 23s", "5h 5m not seconds any more", "1d 5h, and not minutes etc".
- Layout: the existing absolute icon container at `bottom-1 right-2` was converted from `flex items-center gap-1.5` to `flex flex-col items-end gap-0.5`. Row 1 is the existing icons + timestamp (unchanged). Row 2 is the new `<span data-test="portal-msg-meta-line" title="...">{parts.join(" · ")}</span>`. The bottom-anchored container grows upward as the second row is added, so the timestamp visually sits ABOVE the metadata, exactly as the user asked ("in next line").
- `MessageItem` got two new props: `isFinalAssistant: boolean` and `providersData: ProvidersData | undefined`. Both passed through `renderMessage`. The `providersData` reference is the same SWR-backed value already in scope from the existing `useProviders()` call at the top of the session route — no extra fetch. Helper `computeMessageMeta(info, isFinalAssistant, providersData)` lives next to the `MessageItem` definition; returns `{ parts, title } | null`.
- `data-test` hooks added: `portal-msg-meta-stack` on the outer flex-col, `portal-msg-meta-line` on the meta span. Used by the playwright verification, which confirmed 9 meta lines render on a live prod session with the expected `compaction · Claude Opus 4.7 · max · 4m 57s` shape.
- Files: `apps/web/src/lib/format-time.ts` (new `formatDuration`), `apps/web/src/routes/_app/session/$id.tsx` (props + helper + restructured icon row).
- Code shipped together with #92 in commit `2f181c3` (titled `wip: ai meta line + idle banner fix (placeholder)` due to a parallel-agent branch-switch race during the commit window; the title is preserved per the no-force-push-to-main-nowaker rule).

---
