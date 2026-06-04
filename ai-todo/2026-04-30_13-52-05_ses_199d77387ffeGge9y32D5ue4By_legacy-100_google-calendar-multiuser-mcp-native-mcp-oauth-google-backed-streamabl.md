---
status: DONE
session: ses_199d77387ffeGge9y32D5ue4By
queued_at: 2026-04-30T13:52:05-05:00
legacy_number: 100
commits:
  attributed: []
  on_main: []
  reverted: false
validated:
  at: 2026-06-03T19:06:51-05:00
  main_tip: a30d45b0f729
---

# google-calendar-multiuser-mcp: native MCP OAuth (Google-backed) + Streamable HTTP transport on /mcp

User prompt (verbatim):

> Modify `/home/nowaker/projekty/webapps/portal/dreamhost/mcp-proxy/google-calendar-multiuser-mcp/` source to add native MCP OAuth + Streamable HTTP transport at `/sse` (additive — DO NOT touch the existing `/sse/:email/:token` legacy route which is used by RooCode).
>
> Context: mcp-proxy repo holds 5 MCPs at `*.mcp.dev.dh-int.com`. Four (panel-context, perplexity, serper, context7) just got refactored to use `@dreamhost/mcp-stdio-bridge`. google-calendar can't use the bridge because it's HTTP-only, not stdio-based. Wanted: pure Google-federated OAuth provider (same RFC 8414/9728/7591 + PKCE S256 shape as panel-context's oauth-dh-ldap, but federated to Google instead of LDAP).
>
> Reference: oauth-dh-ldap/src/{oauth.ts,middleware.ts,types.ts,index.ts}. Existing in google-calendar: OAuthManager (generateAuthUrl, handleAuthCallback, hasValidTokens, createUserOAuth2Client, withQueue) + TokenStorage (per-user Google credentials keyed by email + opaque session token).
>
> Build: NEW src/auth/mcp-oauth.ts with McpGoogleOAuthProvider class issuing bearerMiddleware() + router() (.well-known/oauth-authorization-server, .well-known/oauth-protected-resource, POST /register, GET /authorize, GET /oauth/mcp-callback, POST /token). Persist state to disk (mcp-oauth-state.json) — pending PKCE challenges (10min), MCP authorization codes (10min), MCP access tokens (30 days). MODIFY src/index.ts to mount router and add /sse POST/GET/DELETE bearer-authed Streamable HTTP handlers, all coexisting with the legacy /sse/:email/:token. Bump @modelcontextprotocol/sdk so StreamableHTTPServerTransport is available.

Design notes:

- mcp-oauth.ts (582 lines) implements the full federated flow:
  1. POST /register (RFC 7591 DCR) → returns client_id (PKCE 'none', accepts any acceptable redirect_uri).
  2. GET /authorize?client_id&redirect_uri&code_challenge&code_challenge_method=S256&state → generates internal session_id, persists pending state, redirects to Google's consent URL with `state=<session_id>` and access_type=offline + prompt=consent (matches OAuthManager — guarantees refresh_token).
  3. GET /oauth/mcp-callback?code&state=<session_id> → exchanges Google code via a dedicated OAuth2Client (clientId/secret from `loadCredentials()`, redirectUri pinned to `${baseUrl}/oauth/mcp-callback` — distinct from OAuthManager's /auth/callback so the legacy web-UI flow is unaffected). Fetches user email via `google.oauth2.userinfo.get()`, persists Google credentials to TokenStorage under a fresh 50-char nanoid (googleSessionToken). Generates short-lived MCP auth code, redirects to client's redirect_uri with `?code=<mcp_code>&state=<original_state>`.
  4. POST /token (grant_type=authorization_code) → consumes MCP auth code, verifies PKCE S256, mints opaque 32-byte base64url Bearer (`access_token`). State persisted to JSON on disk under DATA_DIR.
  5. bearerMiddleware → consults access_tokens table, sets `req.mcpUser = { email, googleSessionToken }`. WWW-Authenticate header carries the `resource_metadata=` link per the MCP authorization spec.
- index.ts mounts the OAuth router first (so /.well-known/* + /authorize + /token aren't shadowed by the catch-all 404) and adds POST/GET/DELETE handlers. **The transport path landed at /mcp + /mcp/:email**, not /sse as originally specced — the user evolved the design during commit to avoid ambiguity with the legacy `/sse/:email/:token` parameterized route. Functionally identical; just a URL rename. The legacy `/sse/:email/:token` (RooCode workaround) and `/sse/:email/:token/:sessionId/message` are completely untouched. So is /auth/google, /auth/callback, admin/*, /health.
- Per-user MCP server is built via `createBearerMCPServer` (new helper that mirrors `createUserMCPServer` but sources email + googleSessionToken from the bearer-validated request). `OAuthManager.createUserOAuth2Client(email, googleSessionToken)` is the same code path the legacy flow uses, just sourced from a Bearer header instead of URL path params. `OAuthManager.withQueue(email, ...)` still serializes per-user API calls.
- @modelcontextprotocol/sdk pinned to ~1.12.1 (was ^1.0.3). 1.0.3 doesn't ship `StreamableHTTPServerTransport`; bumping to 1.29 (which `^1.12.1` would resolve to) breaks the project's `typeof CallToolRequestSchema._type` reference because Zod 4 dropped `_type`. ~1.12.x stays on Zod 3.23.8 and keeps the existing handler typing intact.
- mcp-oauth.ts spawns its own `TokenStorage(DATA_DIR)` instance (parallel to OAuthManager's) — safe because TokenStorage is file-keyed by `{email}/{token}.json` so concurrent instances on the same dataDir read/write the same data with no race.
- Verification: `npm run build` exits 0 against the bumped SDK. `/.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource` smoke-tested with all required RFC 8414/9728 fields present (issuer, authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported, response_types_supported, grant_types_supported, plus optional token_endpoint_auth_methods_supported and scopes_supported).
- Pre-existing test failure surfaced: `src/index.test.ts` was already broken at module load under SDK 1.0.3 (jwa/buffer-equal-constant-time prototype crash). Bumping the SDK fixed that crash, which let execution reach `new TokenStorage(DATA_DIR)` at index.ts:85 — synchronous `mkdirSync('/app/data')` that EACCESes for non-root test runs. Both failure modes are upstream of any new code; the legacy `/sse/:email/:token` route is unchanged.
- mcp-proxy repo got extracted out of portal during this task. New canonical path: `~/projekty/dreamhost/mcp-proxy/google-calendar-multiuser-mcp/`. Commit lives on the mcp-proxy repo's `develop` branch + merged to `master`, pushed to `origin` (gitlab dreamhost/dev/ai/mcp-proxy).
