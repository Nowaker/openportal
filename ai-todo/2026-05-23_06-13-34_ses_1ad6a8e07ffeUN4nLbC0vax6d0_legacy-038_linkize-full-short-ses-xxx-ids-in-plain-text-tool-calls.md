---
status: DONE
session: ses_1ad6a8e07ffeUN4nLbC0vax6d0
queued_at: 2026-05-23T06:13:34-05:00
legacy_number: 38
commits:
  attributed:
    - 77b40c81ffad
  on_main:
    - 77b40c81ffad
  reverted: false
verdict: present
verdict_reason: "commits.attributed all on main as of validation"
verdict_investigated_at: 2026-06-03T19:54:52-05:00
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# Linkize full + short ses_xxx IDs in plain text + tool calls

User prompt:

> Enqueue to the end: full session ids whether plain text or in tool calls, should behave just like paths to files - be linkized. In this case - to open session by ID. Also support shorter session ids like ses_1c35fc059 they currently don't work in portal and I don't even know if they work in opencode but we know session ids so we can immediately link them to the full urls. Openportal should have enough caches to do it without lookup but if lookup to opencode api or sqlite is needed, it's all cool.

Design notes:
- `remark-id-links.ts`: lower session-ID regex floor from `{20,32}` to `{9,32}` chars after `ses_`. Accept optional `RemarkIdLinksOptions.resolveSessionId(partialOrFullId): string | null` callback.
  - Full IDs (20-32 chars) always linkize.
  - Short prefixes (9-19 chars) only linkize when the resolver returns an unambiguous full ID.
  - Ambiguous or unknown prefixes stay as plain text (deliberate "null on ambiguous" invariant — would otherwise generate silently-wrong links).
- `MessageMarkdown` (`routes/_app/session/$id.tsx`): derives `resolveSessionId` from `useSessions()` via exact-match-first-then-unique-prefix-match. Passes to remark via tuple syntax: `[remarkIdLinks, { resolveSessionId }]`.
- MessageMarkdown's `a` component override also gains the same `isOpenPortalInternal` SPA-nav logic from #34 (commit 94c8ced only fixed the standalone MarkdownRenderer; MessageMarkdown had its own override that needed parallel treatment).
- Tool-call JSON-input rendering (parameters block in the tool-call display) doesn't run through markdown. Follow-up commit c7888b8 added a parallel utility `apps/web/src/lib/linkify-session-ids.tsx` that scans arbitrary strings for ses_/msg_ matches and splices in inline `<a>` link elements. Same regex shape as the remark plugin, same null-on-ambiguous-prefix invariant. Wired into ToolInputModal's `FormattedValue` recursive renderer (every string anywhere in the tool input/output tree linkizes) and into the JSON view (`<pre>{jsonText}</pre>` now renders through linkifySessionIds, preserving whitespace + quotes + indentation but linkizing matching tokens).
