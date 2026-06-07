# Session status signal audit

Scope: OpenPortal handling for opencode-native `session.status` retry / usage-limit state and adjacent session signals used by the title-bar badge, sidebar indicators, and chat route.

## Current contract

OpenCode emits `session.status` with this shape:

```ts
type Info =
  | { type: "idle" }
  | { type: "busy" }
  | {
      type: "retry";
      attempt: number;
      message: string;
      next: number;
      action?: {
        reason: string;
        provider: string;
        title: string;
        message: string;
        label: string;
        link?: string;
      };
    };
```

OpenPortal stores the native retry signal separately from the stuck-detector retry verdict:

- `SessionIndicatorState.retry` = stuck-detector inference for stuck sessions.
- `SessionIndicatorState.opencode_retry` = opencode-authored `session.status.type === "retry"`.

This separation is intentional: opencode retry means the upstream runtime is actively handling a transient provider/API condition; stuck-detector retry means the watchdog inferred a stuck retry loop.

## Surfaced signals

| Signal | Source | OpenPortal path | User surface | Status |
|---|---|---|---|---|
| `session.status: idle` | opencode SSE and `/session/status` hydrate | `apps/web/src/server/lib/indicator-state.ts` clears `busy` and `opencode_retry` | Title/sidebar indicators clear | Surfaced |
| `session.status: busy` | opencode SSE and `/session/status` hydrate | `indicator-state.ts` sets `busy=true`, clears native retry | THINKING / TOOL badge depending on tool state | Surfaced |
| `session.status: retry` | opencode SSE and `/session/status` hydrate | `indicator-state.ts` writes `opencode_retry` with attempt, next timestamp, message, action | Title badge `RETRY N`; session view rate-limit banner with 1s countdown and attempt text | Surfaced |
| `message.created` assistant in-flight | opencode SSE | `indicator-state.ts` sets in-flight assistant, mode, busy | THINKING or COMPACTING badge, chat thinking line | Surfaced |
| `message.updated` assistant completed | opencode SSE | `indicator-state.ts` clears in-flight assistant, mode, tool, busy | Busy indicators clear | Surfaced |
| `message.part.updated` running tool | opencode SSE | `indicator-state.ts` tracks `currentToolName` for the in-flight assistant | `TOOL: <name>` title badge | Surfaced |
| `session.error` | opencode SSE | `indicator-state.ts` records `lastError`; chat route renders `SessionLevelErrorBox` | ERROR badge plus in-chat error box | Surfaced |
| `question.asked/replied/rejected` | opencode SSE | `indicator-state.ts` tracks pending question IDs | QUESTION badge/dot and question form surface | Surfaced |
| `permission.asked/replied` | opencode SSE | `indicator-state.ts` tracks pending permission IDs | PERMISSION badge/dot and permission widget | Surfaced |
| `todo.updated` | opencode SSE | `indicator-state.ts` reads `properties.todos` and stores counts/items | Todo strip/counts | Surfaced |
| `session.deleted` | opencode SSE | `indicator-state.ts` removes indicator entry | Sidebar/session indicators remove | Surfaced |
| `message.part.delta` | opencode SSE | not consumed by indicator state | Chat message streaming path owns content deltas | Intentionally not an indicator signal |
| `message.removed/message.part.removed` | opencode SSE | indicator state ignores; cache invalidation handled by broadcaster/caches | Chat cache reconciliation/removal | Surfaced outside indicator state |

## Fixes shipped for #137

- `311d248 indicator: ingest opencode-native session.status retry`
  - Corrected `session.status` parsing from the nonexistent `props.info.time.completed` shape to `props.status.type`.
  - Added `opencode_retry` to `SessionIndicatorState`.
  - Updated `/session/status` hydration to pass the REST `Info` union through the same `status` property as live SSE frames.
  - Added unit coverage that native RETRY surfaces before TOOL/THINKING and uses a distinct orange visual.
- `0cd2dd1 session: surface opencode retry as rate-limit banner`
  - Added the session-view rate-limit banner for `opencode_retry`.
  - Shows provider/action text, attempt number, and a 1s ticking countdown until the next attempt.

## Verification

- Focused unit surface: `apps/web/src/components/session-status-badge.test.ts` covers the native retry badge, priority over TOOL/THINKING, and retry color distinctness.
- Live API check during this sync: `GET http://100.105.229.19:5000/api/indicators` returned `{"sessions":[],"ok":true}`. That verifies the deployed indicator API is reachable; no active retry existed at the moment of the probe, so there was no live retry row to observe.
- Direct local opencode status probe to `127.0.0.1:4096/session/status` failed because the configured user-managed opencode is not listening on local loopback in this session context. Per project rules, OpenPortal should not restart user-managed opencode just to manufacture a retry event.

## Residual risk

There is no deterministic in-repo fixture that injects a real provider retry into running opencode. The shipped tests cover the OpenPortal decision logic; the live probe confirms the production indicator endpoint is healthy but currently idle.
