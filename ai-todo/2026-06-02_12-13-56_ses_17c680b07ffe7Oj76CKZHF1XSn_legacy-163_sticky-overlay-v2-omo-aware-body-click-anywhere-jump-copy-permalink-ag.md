---
status: PENDING
commit: 
session: ses_17c680b07ffe7Oj76CKZHF1XSn
queued_at: 2026-06-02T12:13:56-05:00
legacy_number: 163
---

# Sticky overlay v2: OMO-aware body, click-anywhere jump, copy + permalink + agent/model/variant rows; shared MessageMetaStack on user messages (DONE - this commit) [loser-bump: originally #161; bumped to #163 because OMO fenced-code (#161) and composer-padding (#162) landed on origin/main-nowaker concurrently with this work]

User prompt (verbatim):

> https://portal.desktop.ts.nowaker.net/session/ses_17ad702d4ffeM1JhOURJen44xa?server=srv-2dy1srwz#msg-msg_e86c47515001Wk5Bu1ET4TnVjk - this message shows as:
>
> ```<!--OMO-STRIPPED:%7B%22id%22%3A%220.0%22%2C%22header%22%3A%22%5BSYSTEM%20DIRECTIVE%3A%20OH-MY-OPENCODE%20-%20TODO%20CONTINUATION%5D%22%2C%22summary%22%3A%22%5BStatus%3A%205%2F6%20completed%2C%201%20remaining%5D%22%2C%22bytes%22%3A728%2C%22segments%22%3A%5B%7B%22heade...```
>
> in the floatie.
> should show like other omo wrapper, in the floatie.
>
> also let's remove "Jump" button and make the whole box clickable - and click jumps there.
>
> in place of jump button, introduce limited set of status fields:
>
> [copy button] datetime-as-permalink  \n
> agent name · model name · variant name (if known)
>
> also, note that currently user inputs don't carry this block: Sisyphus - ultraworker · Claude Opus 4.8 · 1m 54s · 29m 36s. introduce them there too.
>
> remember the DRY principle. reuse code. maybe introduce a sort of global component/function, that renders the one line or two line block, depending on circumstances (parameter passed by caller as to what they want exposed).
> this way, we can have user prompt entry two line with certain buttons, and next line with agent - model - variant, and no times. final assistant responses will have that + one message processing + all messages processing if more than one message in between. tool calls will have one line, etc.

Design notes:

- Sticky now parses the user-message text through `parseOmoBlocks` and renders each block. OMO blocks (including pure `<!--OMO-STRIPPED:...-->` markers that arrived bodyless from the server bandwidth optimization) render via the new compact `OmoBlockCompact` pill — header + summary inline, no expand action (the chat below still has the full expandable `OmoBlockView`).
- Sticky pill body is no longer wrapped in a "jump" button. The whole pill is a `role="button"` div with `onClick` calling `scrollIntoView` on the matching `[data-message-id]` element. A selection guard short-circuits the click when `window.getSelection().isCollapsed === false` so users can highlight prompt text without accidentally jumping. Clicks on inner interactive elements (`button, a, input, textarea`) bubble through `e.stopPropagation` so the chevron + copy + permalink keep their own click semantics.
- Sticky meta row added: `[copy button] datetime-as-permalink` on line 1, `agent · model · variant` on line 2 (no times — sticky is for user prompts, not turn-end assistant summaries).
- DRY refactor — extracted shared modules:
  - `apps/web/src/lib/clipboard.ts` — `copyTextToClipboard` (was inline in `session/$id.tsx`).
  - `apps/web/src/components/copy-markdown-button.tsx` — `CopyMarkdownButton` (was inline).
  - `apps/web/src/components/message-permalink-timestamp.tsx` — `MessagePermalinkTimestamp` + `flashMessageHighlight` (were inline). `titleAt` prop loosened to `string | undefined` to match the call sites that pass `formatAbsoluteAndRelative(...)` (which returns `string | undefined`).
  - `apps/web/src/components/message-meta-stack.tsx` — new `MessageMetaStack` component. Renders 0, 1, or 2 lines depending on which props are supplied:
    - Line 1: `leading` slot (chat icons) → optional `copyText` → `trailing` slot (chat info icon) → `timestamp` (permalink) OR `timestampPlain` (for pending messages whose IDs aren't navigable).
    - Line 2: `meta.parts.join(" · ")`.
  - `apps/web/src/lib/message-meta.ts` — `computeMessageMeta` + `ProvidersData` + `MessageMeta` types. `computeMessageMeta` now accepts `nextAssistantInfo` and derives `agent`/`modelName`/`variant` from the FOLLOWING assistant for user messages (since user messages don't carry the agent-routing fields themselves). `stepDuration` + `totalDuration` remain gated on `info.role === "assistant" && isFinalAssistant`. The title prefix for user-message metadata is `Assistant settings for the following response` so the hover tooltip explains why a user message displays Sisyphus / Opus.
  - `apps/web/src/components/omo-block-compact.tsx` — single-line non-expandable pill for OMO blocks used inside the sticky.
- `session/$id.tsx`:
  - Replaced inline `copyTextToClipboard`, `CopyMarkdownButton`, `flashMessageHighlight`, `MessagePermalinkTimestamp`, `computeMessageMeta`, `ProvidersData`, `MessageMeta` with imports from the new shared modules.
  - `MessageItem` now accepts `nextAssistantInfo` prop. `renderMessage` derives it for user messages by scanning forward through `ctx.baseVisible` for the first assistant after the user message. For assistant messages and the no-assistant-yet case, `nextAssistantInfo` is null.
  - The existing absolute-positioned floating meta stack (star / fork / revert / copy / info / timestamp + meta line) refactored to `<MessageMetaStack>` with the chat icons in the `leading` slot and the info icon in the `trailing` slot. Visual order preserved: star, fork, revert, copy, info, timestamp.
  - With `computeMessageMeta` now returning a non-null result for user messages with a following assistant, user messages in the chat ALSO display the `agent · model · variant` line — matching the spec's "introduce them there too".
  - `<StickyUserPromptOverlay>` call site updated to pass `providersData` (so the sticky can derive its own meta line).
- Visual verification: navigated `/session/ses_17ad702d4ffeM1JhOURJen44xa?server=srv-local-4096#msg-msg_e86c47515001Wk5Bu1ET4TnVjk` in the worktree (port 5200) — the floatie text changed from `<!--OMO-STRIPPED:%7B%22id%22%3A%220.0%22%2C...` to `[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION] [Status: 5/6 completed, 1 remaining]` + `12:18 AM` + `Sisyphus - ultraworker · Claude Opus 4.8`. Click on the body region jumped to the message and hid the sticky.
- Branch: worktree `~/projekty/webapps/portal-sticky-prompt` on `feat/sticky-user-prompt-v2` off `main-nowaker`.
