# OpenCode MCP States and OAuth Authentication

**Date**: May 21, 2026  
**Source**: opencode codebase investigation  
**Scope**: MCP server state tracking, HTTP API surface, OAuth/auth mechanisms

---

## 1. MCP Server States (Complete Enum)

OpenCode tracks **5 distinct MCP server states**. All are defined in the Status union type.

### State Definitions

| State | Internal Name | Field Type | Meaning | Has Error Field |
|-------|---------------|-----------|---------|-----------------|
| `connected` | `StatusConnected` | `{ status: "connected" }` | MCP server is live and tools are available | No |
| `disabled` | `StatusDisabled` | `{ status: "disabled" }` | Server is configured but explicitly disabled (not connected) | No |
| `failed` | `StatusFailed` | `{ status: "failed", error: string }` | Connection failed (network, timeout, invalid config, etc.) | Yes |
| `needs_auth` | `StatusNeedsAuth` | `{ status: "needs_auth" }` | Server requires OAuth authentication before connection | No |
| `needs_client_registration` | `StatusNeedsClientRegistration` | `{ status: "needs_client_registration", error: string }` | Server requires pre-registered OAuth client ID (dynamic registration not supported) | Yes |

### Source Code References

- **State Schema Definition**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/mcp/index.ts:72-95`
  ```typescript
  const StatusConnected = Schema.Struct({ status: Schema.Literal("connected") })
  const StatusDisabled = Schema.Struct({ status: Schema.Literal("disabled") })
  const StatusFailed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String })
  const StatusNeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") })
  const StatusNeedsClientRegistration = Schema.Struct({
    status: Schema.Literal("needs_client_registration"),
    error: Schema.String,
  })
  
  export const Status = Schema.Union([
    StatusConnected,
    StatusDisabled,
    StatusFailed,
    StatusNeedsAuth,
    StatusNeedsClientRegistration,
  ])
  export type Status = Schema.Schema.Type<typeof Status>
  ```

### State Transitions

```
disabled ──[connect]──> connected
                    ├─> needs_auth (if OAuth required)
                    ├─> needs_client_registration (if dynamic registration fails)
                    └─> failed (if connection fails)

needs_auth ──[authenticate]──> connected
                            └─> failed

connected ──[disconnect]──> disabled
```

---

## 2. HTTP API Surface for MCP State & Auth

OpenCode exposes **8 HTTP endpoints** for MCP management via the experimental HttpApi.

### Endpoints

#### 2.1 Get MCP Status (All Servers)
- **Method**: `GET`
- **Path**: `/mcp`
- **Query Params**: `?directory=<workspace-path>` (required)
- **Response**: `Record<string, Status>`
- **Example Response**:
  ```json
  {
    "my-server": { "status": "connected" },
    "oauth-server": { "status": "needs_auth" },
    "broken-server": { "status": "failed", "error": "Connection timeout" }
  }
  ```
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:44-52`

#### 2.2 Add MCP Server
- **Method**: `POST`
- **Path**: `/mcp`
- **Query Params**: `?directory=<workspace-path>` (required)
- **Payload**:
  ```json
  {
    "name": "server-name",
    "config": {
      "type": "remote" | "local",
      "url": "https://...",
      "command": ["..."],
      "enabled": true,
      "oauth": true | false | { clientId, clientSecret, scope, redirectUri }
    }
  }
  ```
- **Response**: `Record<string, Status>` (status of all servers after add)
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:54-64`

#### 2.3 Start OAuth Flow
- **Method**: `POST`
- **Path**: `/mcp/:name/auth`
- **Params**: `name` = MCP server name
- **Query Params**: `?directory=<workspace-path>` (required)
- **Response**:
  ```json
  {
    "authorizationUrl": "https://oauth-provider.com/authorize?...",
    "oauthState": "random-state-string"
  }
  ```
- **Errors**:
  - `400 McpUnsupportedOAuthError` if server doesn't support OAuth
  - `404 NotFound` if server not found
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:66-76`

#### 2.4 Complete OAuth Flow (Callback)
- **Method**: `POST`
- **Path**: `/mcp/:name/auth/callback`
- **Params**: `name` = MCP server name
- **Query Params**: `?directory=<workspace-path>` (required)
- **Payload**:
  ```json
  {
    "code": "authorization-code-from-oauth-provider"
  }
  ```
- **Response**: `Status` (updated server status after auth)
- **Errors**:
  - `400 BadRequest` if code is invalid
  - `404 NotFound` if server not found
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:78-90`

#### 2.5 Authenticate (Start + Wait for Callback)
- **Method**: `POST`
- **Path**: `/mcp/:name/auth/authenticate`
- **Params**: `name` = MCP server name
- **Query Params**: `?directory=<workspace-path>` (required)
- **Response**: `Status` (updated server status after auth)
- **Behavior**: Opens browser automatically, waits for OAuth callback
- **Errors**:
  - `400 McpUnsupportedOAuthError` if server doesn't support OAuth
  - `404 NotFound` if server not found
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:92-102`

#### 2.6 Remove OAuth Credentials
- **Method**: `DELETE`
- **Path**: `/mcp/:name/auth`
- **Params**: `name` = MCP server name
- **Query Params**: `?directory=<workspace-path>` (required)
- **Response**:
  ```json
  {
    "success": true
  }
  ```
- **Errors**:
  - `404 NotFound` if server not found
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:104-114`

#### 2.7 Connect MCP Server
- **Method**: `POST`
- **Path**: `/mcp/:name/connect`
- **Params**: `name` = MCP server name
- **Query Params**: `?directory=<workspace-path>` (required)
- **Response**: `true` (boolean)
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:116-124`

#### 2.8 Disconnect MCP Server
- **Method**: `POST`
- **Path**: `/mcp/:name/disconnect`
- **Params**: `name` = MCP server name
- **Query Params**: `?directory=<workspace-path>` (required)
- **Response**: `true` (boolean)
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:126-134`

### Handler Implementation

All handlers are implemented in:  
`/home/nowaker/projekty/webapps/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`

---

## 3. OAuth/Auth Handshake: Web Client Capability

### Answer: **YES, web clients CAN drive MCP OAuth from HTTP API**

OpenCode exposes **full OAuth primitives** via HTTP API. A web client can:

1. **Initiate OAuth** → `POST /mcp/:name/auth` → get `authorizationUrl` + `oauthState`
2. **Redirect user** → Open `authorizationUrl` in browser
3. **Receive callback** → OAuth provider redirects to `http://127.0.0.1:19876/mcp/oauth/callback`
4. **Complete auth** → `POST /mcp/:name/auth/callback` with authorization code
5. **Verify status** → `GET /mcp` to confirm `status: "connected"`

### OAuth Flow Details

#### Callback Server
- **Port**: `19876` (configurable via `redirectUri` in config)
- **Path**: `/mcp/oauth/callback`
- **Default Redirect URI**: `http://127.0.0.1:19876/mcp/oauth/callback`
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/mcp/oauth-provider.ts:14-15`

#### OAuth State Management
- **State Parameter**: Random 32-byte hex string, stored in `mcp-auth.json`
- **CSRF Protection**: State mismatch throws error (line 866-868 in index.ts)
- **Timeout**: Callback waits indefinitely (user can cancel)
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/mcp/oauth-callback.ts`

#### Token Storage
- **Location**: `~/.opencode/data/mcp-auth.json` (encrypted with mode `0o600`)
- **Fields Stored**:
  - `accessToken` (required)
  - `refreshToken` (optional)
  - `expiresAt` (optional, Unix timestamp in seconds)
  - `scope` (optional)
  - `clientInfo` (optional, for dynamic registration)
  - `codeVerifier` (optional, for PKCE)
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/mcp/auth.ts:6-28`

#### Dynamic Client Registration
- **Supported**: Yes, if MCP server supports it
- **Fallback**: If server doesn't support dynamic registration, requires pre-configured `clientId` in config
- **Error State**: `needs_client_registration` with error message
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/mcp/index.ts:361-365`

### Auth Status Tracking

OpenCode also tracks **authentication status** separately from connection status:

```typescript
export type AuthStatus = "authenticated" | "expired" | "not_authenticated"
```

- **authenticated**: Valid, non-expired tokens stored
- **expired**: Tokens exist but `expiresAt < now`
- **not_authenticated**: No tokens stored

**Query Method**: `GET /mcp` returns `Status` (connection state), not `AuthStatus`. Use SDK method `mcp.getAuthStatus(name)` for auth-specific status.

**Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/mcp/index.ts:917-922`

### CLI-Driven Auth (Alternative)

OpenCode also supports CLI-driven auth via `opencode mcp auth [name]`:
- Opens browser automatically
- Waits for callback
- Stores tokens
- **Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/cli/cmd/mcp.ts:170-310`

---

## 4. Visual UX: State-to-Color Mapping in opencode-web

### Current UI Implementation

**Component**: `/home/nowaker/projekty/webapps/opencode/packages/app/src/components/dialog-select-mcp.tsx`

#### Status Label Mapping

| State | i18n Key | Display Text | UI Behavior |
|-------|----------|--------------|-------------|
| `connected` | `mcp.status.connected` | "connected" | Toggle shows as ON (Switch enabled) |
| `disabled` | `mcp.status.disabled` | "disabled" | Toggle shows as OFF (Switch disabled) |
| `needs_auth` | `mcp.status.needs_auth` | "needs auth" | Toggle shows as OFF; clicking triggers auth flow |
| `failed` | `mcp.status.failed` | "failed" | Toggle shows as OFF; error message displayed below |
| `needs_client_registration` | `mcp.status.needs_client_registration` | (no i18n yet) | Toggle shows as OFF; error message displayed below |

**Source**: `/home/nowaker/projekty/webapps/opencode/packages/app/src/components/dialog-select-mcp.tsx:12-18`

#### CSS Classes Used

- **Status Label**: `text-11-regular text-text-weaker` (small, dimmed text)
- **Error Message**: `text-11-regular text-text-weaker truncate` (small, dimmed, truncated)
- **No color differentiation** in current UI (all states use same text color)

**Source**: `/home/nowaker/projekty/webapps/opencode/packages/app/src/components/dialog-select-mcp.tsx:87-93`

#### CLI Status Icons (for reference)

The CLI uses visual icons to differentiate states:

| State | Icon | Meaning |
|-------|------|---------|
| `connected` | `✓` | Success |
| `disabled` | `○` | Neutral/inactive |
| `needs_auth` | `⚠` | Warning |
| `needs_client_registration` | `✗` | Error |
| `failed` | `✗` | Error |

**Source**: `/home/nowaker/projekty/webapps/opencode/packages/opencode/src/cli/cmd/mcp.ts:131-158`

#### i18n Labels (English)

```json
{
  "mcp.status.connected": "connected",
  "mcp.status.failed": "failed",
  "mcp.status.needs_auth": "needs auth",
  "mcp.status.disabled": "disabled",
  "mcp.auth.clickToAuthenticate": "Click to authenticate"
}
```

**Source**: `/home/nowaker/projekty/webapps/opencode/packages/app/src/i18n/en.ts`

---

## 5. Implementation Checklist for OpenPortal

### To Surface MCP States in OpenPortal UI:

- [ ] Query `GET /mcp?directory=<workspace>` to get all server statuses
- [ ] Map status values to visual indicators:
  - `connected` → Green checkmark, enabled toggle
  - `disabled` → Gray circle, disabled toggle
  - `needs_auth` → Orange warning icon, "Authenticate" button
  - `failed` → Red X, error message tooltip
  - `needs_client_registration` → Red X, error message tooltip
- [ ] Display error messages from `status.error` field for `failed` and `needs_client_registration`

### To Enable OAuth from Web UI:

1. **Initiate**: `POST /mcp/:name/auth` → get `authorizationUrl`
2. **Redirect**: Open `authorizationUrl` in new window/tab
3. **Wait**: Poll `GET /mcp?directory=<workspace>` until status changes to `connected`
4. **Fallback**: If user closes browser window, show "Authorization cancelled" message
5. **Error Handling**: If status becomes `failed` or `needs_client_registration`, display error

### Alternative: Use `authenticate` Endpoint

- **Simpler**: `POST /mcp/:name/auth/authenticate` handles browser open + callback wait
- **Caveat**: Requires opencode to have browser access (may not work in headless/remote scenarios)
- **Recommended**: Use `auth` + `auth/callback` for web clients (more control)

---

## 6. Code References Summary

| Aspect | File | Lines |
|--------|------|-------|
| State enum definition | `packages/opencode/src/mcp/index.ts` | 72-95 |
| HTTP API routes | `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts` | 31-153 |
| HTTP API handlers | `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts` | 1-68 |
| Auth storage | `packages/opencode/src/mcp/auth.ts` | 1-146 |
| OAuth provider | `packages/opencode/src/mcp/oauth-provider.ts` | 1-214 |
| OAuth callback server | `packages/opencode/src/mcp/oauth-callback.ts` | (full file) |
| UI component | `packages/app/src/components/dialog-select-mcp.tsx` | 1-111 |
| CLI commands | `packages/opencode/src/cli/cmd/mcp.ts` | 1-775 |
| i18n labels | `packages/app/src/i18n/en.ts` | (search "mcp.status") |

---

## 7. Key Takeaways

1. **5 States**: `connected`, `disabled`, `failed`, `needs_auth`, `needs_client_registration`
2. **Full HTTP API**: All MCP operations exposed via REST endpoints
3. **Web-Driven OAuth**: Yes, via `/mcp/:name/auth` + `/mcp/:name/auth/callback`
4. **Token Storage**: Encrypted in `~/.opencode/data/mcp-auth.json`
5. **CSRF Protection**: OAuth state parameter validated
6. **Dynamic Registration**: Supported; falls back to pre-configured `clientId`
7. **UI Status**: Currently text-only; no color differentiation (opportunity for enhancement)
8. **CLI Icons**: Uses ✓/⚠/✗ for visual differentiation (reference for web UI)

