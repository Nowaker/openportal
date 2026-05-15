# OpenPortal Polling & SSE Audit

**Date**: 2026-05-15  
**Scope**: `apps/web/src` (280 files)  
**Methodology**: Exhaustive grep for `useSWR` + `refreshInterval`, `setInterval`/`setTimeout`, and SSE consumers

---

## 1. SWR Polling Locations (useSWR with refreshInterval)

| File | Line | Endpoint | Interval | Data | Strategy-Aware? |
|------|------|----------|----------|------|-----------------|
| `hooks/use-pinned-sessions.ts` | 19 | `/api/state/pinned` | 5000ms | Pinned session list | No |
| `hooks/use-opencode.ts` | 100 | `/api/opencode/{port}/session/status` | 3000ms (polling mode) | Session busy/retry/idle status | Yes (usePollMs) |
| `hooks/use-opencode.ts` | 241 | `/api/opencode/{port}/permissions` | 2000ms (polling mode) | Permissions list | Yes (usePollMs) |
| `hooks/use-opencode.ts` | 271 | `/api/opencode/{port}/questions` | 2000ms (polling mode) | Questions list | Yes (usePollMs) |
| `hooks/use-session-messages.ts` | 79 | `/api/opencode/{port}/session/{id}/messages` | 3000ms (polling mode) | Session messages + parts | Yes (usePollMs) |
| `hooks/use-plugin-info.ts` | 48 | `/api/opencode/{port}/plugin-info?spec=...` | 1500ms (conditional) | Plugin metadata (while null) | No |
| `hooks/use-last-viewed.ts` | 15 | `/api/state/last-viewed` | 5000ms | Last-viewed session timestamps | No |
| `routes/servers.tsx` | 192 | `/api/servers` | 5000ms | Server list | No |
| `routes/_app/session/$id.tsx` | 2609 | `/api/prompts/pending?session=...` | 2000ms | Pending prompts for session | No |
| `components/companion-telemetry-panel.tsx` | 218 | `/api/companion-plugin-state?port=...` | 5000ms | Companion plugin state | No |
| `components/companion-telemetry-panel.tsx` | 223 | `/api/companion-plugin/detect-instances` | 15000ms | Detected companion instances | No |
| `components/mcp-info-modal.tsx` | 64 | `/api/opencode/{port}/mcp-details?name=...` | 1500ms (conditional) | MCP server details (while null) | No |

**Summary**: 12 polling locations. 4 are strategy-aware (use `usePollMs` to disable polling when SSE is active). 8 are unconditional.

---

## 2. setInterval/setTimeout Polling (Non-SWR)

| File | Line | Purpose | Interval | Notes |
|------|------|---------|----------|-------|
| `hooks/use-connection-monitor.ts` | 116 | Health probe (`/api/instance/self`) | 10000ms | Detects openportal/opencode outages; triggers global SWR mutate on reconnect |
| `hooks/use-build-mismatch.ts` | 39 | Build ID mismatch detection | 60000ms | Piggybacks on connection-monitor's `/api/instance/self` probe |
| `routes/_app/session/$id.tsx` | 3263 | Refresh pending permissions | 2000ms | Calls `refreshPendingPermissions()` |
| `server/plugins/auto-approve-worker.ts` | 199 | Server reconciliation | 30000ms | Starts/stops SSE connections per configured server |
| `server/plugins/pending-prompt-worker.ts` | 102 | Pending prompt delivery scan | 5000ms | Drains pending prompts from DB; woken on POST |

**Summary**: 5 timer-based pollers. 2 are infrastructure (health/build-check). 3 are business logic (permissions, auto-approve, prompt delivery).

---

## 3. SSE Consumers (EventSource Subscribers)

### Client-Side SSE

**File**: `hooks/use-event-stream.ts`

- **Endpoint**: `/api/opencode/{port}/event` (Portal's SSE proxy of opencode's `/event`)
- **Strategy**: Conditional on `useActiveStrategy()` (disabled when strategy === "polling")
- **Handled Events**:
  - `message.updated`, `message.part.updated`, `message.part.removed`, `message.removed`, `todo.updated` → invalidate `/api/opencode/{port}/session/{id}/messages`
  - `message.part.delta` → invalidate messages (throttled to 250ms window per session in "chunked" mode)
  - `session.status`, `session.idle` → invalidate `/api/opencode/{port}/session/status`
  - `question.asked`, `question.replied`, `question.rejected` → invalidate `/api/opencode/{port}/questions`
  - `permission.asked`, `permission.replied` → invalidate `/api/opencode/{port}/permissions`
  - `session.created`, `session.updated`, `session.deleted`, `session.compacted`, `session.error` → invalidate `/api/opencode/{port}/sessions`

### Server-Side SSE

**File**: `server/plugins/auto-approve-worker.ts`

- **Endpoint**: `http://{opencode-host}:{port}/event` (direct to opencode, not proxied)
- **Purpose**: Auto-approve permission requests based on session-level settings
- **Handled Events**: `permission.asked` only
- **Reconciliation**: Every 30s, reconciles configured servers and starts/stops connections

**File**: `server/opencode/[port]/event.ts`

- **Type**: SSE pass-through proxy with cache-invalidation tap
- **Purpose**: Proxies opencode's `/event` to browser; invalidates messages cache on delta events
- **Handled Events**: `message.part.delta`, `message.part.updated`, `message.updated`, `message.part.removed`, `message.removed`

---

## 4. Polling vs. SSE Coverage Matrix

| Polled Endpoint | Data | SSE Covers? | Event Type | Status | Recommendation |
|-----------------|------|-------------|-----------|--------|-----------------|
| `/api/opencode/{port}/session/status` | Session busy/retry/idle | Yes | `session.status`, `session.idle` | **COVERED** | Disable polling when SSE active (already done via `usePollMs`) |
| `/api/opencode/{port}/session/{id}/messages` | Messages + parts | Yes | `message.*`, `todo.updated` | **COVERED** | Disable polling when SSE active (already done via `usePollMs`) |
| `/api/opencode/{port}/questions` | Questions list | Yes | `question.asked`, `question.replied`, `question.rejected` | **COVERED** | Disable polling when SSE active (already done via `usePollMs`) |
| `/api/opencode/{port}/permissions` | Permissions list | Yes | `permission.asked`, `permission.replied` | **COVERED** | Disable polling when SSE active (already done via `usePollMs`) |
| `/api/opencode/{port}/sessions` | Sessions list | Yes | `session.created`, `session.updated`, `session.deleted`, `session.compacted`, `session.error` | **COVERED** | Already handled by SSE (no polling found) |
| `/api/state/pinned` | Pinned sessions | No | N/A | **NOT COVERED** | No SSE infrastructure; polling is fallback |
| `/api/state/last-viewed` | Last-viewed timestamps | No | N/A | **NOT COVERED** | No SSE infrastructure; polling is fallback |
| `/api/servers` | Server list | No | N/A | **NOT COVERED** | No SSE infrastructure; polling is fallback |
| `/api/prompts/pending?session=...` | Pending prompts | Partial | N/A | **PARTIALLY COVERED** | Server-side worker delivers prompts; client polls for status. Could use SSE or webhook. |
| `/api/companion-plugin-state?port=...` | Companion state | No | N/A | **NOT COVERED** | No SSE infrastructure; polling is fallback |
| `/api/companion-plugin/detect-instances` | Detected instances | No | N/A | **NOT COVERED** | No SSE infrastructure; polling is fallback |
| `/api/opencode/{port}/plugin-info?spec=...` | Plugin metadata | No | N/A | **NOT COVERED** | Conditional polling while null; no SSE |
| `/api/opencode/{port}/mcp-details?name=...` | MCP details | No | N/A | **NOT COVERED** | Conditional polling while null; no SSE |

---

## 5. Per-Endpoint Migration Recommendations

### HIGH PRIORITY (Already SSE-covered, polling is strategy-aware)

#### `/api/opencode/{port}/questions`
- **Current**: Polled at 2000ms (polling mode only, via `usePollMs`)
- **SSE**: `question.asked`, `question.replied`, `question.rejected` events handled in `use-event-stream.ts`
- **Status**: Already strategy-aware; polling disabled when SSE active
- **Action**: No change needed; working as designed
- **Effort**: None

#### `/api/opencode/{port}/permissions`
- **Current**: Polled at 2000ms (polling mode only, via `usePollMs`)
- **SSE**: `permission.asked`, `permission.replied` events handled in `use-event-stream.ts`
- **Status**: Already strategy-aware; polling disabled when SSE active
- **Action**: No change needed; working as designed
- **Effort**: None

#### `/api/opencode/{port}/session/status`
- **Current**: Polled at 3000ms (polling mode only, via `usePollMs`)
- **SSE**: `session.status`, `session.idle` events handled
- **Status**: Already strategy-aware; polling disabled when SSE active
- **Action**: No change needed; working as designed
- **Effort**: None

#### `/api/opencode/{port}/session/{id}/messages`
- **Current**: Polled at 3000ms (polling mode only, via `usePollMs`)
- **SSE**: `message.*`, `todo.updated` events handled
- **Status**: Already strategy-aware; polling disabled when SSE active
- **Action**: No change needed; working as designed
- **Effort**: None

### MEDIUM PRIORITY (Polling is fallback, SSE infrastructure exists)

#### `/api/prompts/pending?session=...`
- **Current**: Polled at 2000ms unconditionally
- **SSE**: No direct SSE event; server-side worker delivers prompts asynchronously
- **Status**: Polling is the only client-side notification mechanism
- **Action**: Consider adding SSE event when prompt is delivered, or keep polling as fallback
- **Effort**: Medium (requires server-side event emission)

### LOW PRIORITY (No SSE infrastructure, polling is necessary)

#### `/api/state/pinned`, `/api/state/last-viewed`
- **Current**: Polled at 5000ms unconditionally
- **SSE**: No infrastructure
- **Status**: Polling is the only mechanism
- **Action**: Consider adding SSE infrastructure if real-time updates are desired; otherwise keep polling
- **Effort**: High (requires new SSE event types + server-side emission)

#### `/api/servers`
- **Current**: Polled at 5000ms unconditionally
- **SSE**: No infrastructure
- **Status**: Polling is the only mechanism
- **Action**: Consider adding SSE infrastructure if real-time updates are desired; otherwise keep polling
- **Effort**: High (requires new SSE event types + server-side emission)

#### `/api/companion-plugin-state?port=...`, `/api/companion-plugin/detect-instances`
- **Current**: Polled at 5000ms and 15000ms unconditionally
- **SSE**: No infrastructure
- **Status**: Polling is the only mechanism
- **Action**: Consider adding SSE infrastructure if real-time updates are desired; otherwise keep polling
- **Effort**: High (requires new SSE event types + server-side emission)

#### `/api/opencode/{port}/plugin-info?spec=...`, `/api/opencode/{port}/mcp-details?name=...`
- **Current**: Conditional polling at 1500ms while data is null (loading state)
- **SSE**: No infrastructure
- **Status**: Polling is the only mechanism; used to detect when async resolution completes
- **Action**: Keep polling; this is a reasonable pattern for async operations
- **Effort**: N/A (working as designed)

---

## 6. Summary Statistics

| Metric | Count |
|--------|-------|
| Total SWR polling locations | 12 |
| Strategy-aware (usePollMs) | 4 |
| Unconditional polling | 8 |
| Timer-based pollers (setInterval/setTimeout) | 5 |
| SSE event types handled | 13 |
| Endpoints with SSE coverage | 5 |
| Endpoints without SSE coverage | 8 |
| Endpoints with partial SSE coverage | 1 |

---

## 7. Key Findings

### Good News: Core Opencode Data is Already Strategy-Aware

The 4 most critical polling endpoints are **already using `usePollMs`** to disable polling when SSE is active:
- `/api/opencode/{port}/session/status` (3000ms polling mode)
- `/api/opencode/{port}/session/{id}/messages` (3000ms polling mode)
- `/api/opencode/{port}/questions` (2000ms polling mode)
- `/api/opencode/{port}/permissions` (2000ms polling mode)

This means:
- **In "asap" mode (desktop default)**: Polling is disabled; SSE drives all updates
- **In "chunked" mode (mobile default)**: Polling is disabled; SSE drives updates with 250ms throttling
- **In "snapshot" mode**: Polling is disabled; SSE drives updates for snapshot events only
- **In "polling" mode**: Polling is enabled; SSE is not used

### Concern: 8 Unconditional Pollers Ignore Strategy

These endpoints poll regardless of update strategy:
- `/api/state/pinned` (5000ms)
- `/api/state/last-viewed` (5000ms)
- `/api/servers` (5000ms)
- `/api/prompts/pending?session=...` (2000ms)
- `/api/companion-plugin-state?port=...` (5000ms)
- `/api/companion-plugin/detect-instances` (15000ms)
- `/api/opencode/{port}/plugin-info?spec=...` (1500ms conditional)
- `/api/opencode/{port}/mcp-details?name=...` (1500ms conditional)

These are candidates for SSE migration if real-time updates are desired.

### Infrastructure: SSE is Fully Operational

- Client-side: `use-event-stream.ts` subscribes to `/api/opencode/{port}/event` and invalidates SWR keys
- Server-side: `event.ts` proxies opencode's SSE with cache-invalidation tap
- Auto-approve: `auto-approve-worker.ts` listens to permission events server-side
- Prompt delivery: `pending-prompt-worker.ts` drains queue every 5s

---

## 8. Next Steps

1. **No immediate action needed** for the 4 strategy-aware endpoints (session status, messages, questions, permissions) - they're working as designed
2. **Evaluate pending prompts**: Determine if `/api/prompts/pending` polling is necessary or if server-side delivery is sufficient
3. **Consider SSE for state endpoints**: If real-time sync across tabs is desired for pinned/last-viewed, add SSE infrastructure
4. **Companion plugin**: Evaluate if companion state changes warrant SSE infrastructure
5. **Monitor polling load**: The 8 unconditional pollers generate ~1 request per 2-5 seconds per active user; consider impact at scale

