# Tasks MCP Connection (OAuth 2.1 protected resource)

Status: implemented
Date: 2026-08-24

## Goal

Expose **Open Mercato Task Management only** over a remote MCP endpoint, protected by
OAuth 2.1 (authorization code + PKCE S256), scoped by `tasks:read` / `tasks:write`, and
enforcing the full existing authorization stack: OAuth scope **AND** Open Mercato RBAC
features **AND** tenant/organization isolation **AND** module entitlement.

No other ERP surface is reachable through this endpoint.

## Why a new `mcp` module

The repository already ships MCP support, but only in shapes that are unsuitable here:

| Existing surface | Why it is not reused as-is |
|---|---|
| `runMcpServer` (stdio, `lib/mcp-server.ts`) | Local process transport, not remotely reachable. |
| `runMcpDevServer` (`lib/mcp-dev-server.ts`, port 3001) | Dev-only, authenticated by a permanent `omk_` API key read from `.mcp.json`. |
| `loadAllModuleTools()` | Registers **Code Mode** tools (`node:vm` sandbox + `api.request()` over the whole OpenAPI surface). That is precisely the "generic escape hatch" this connection must not expose. |

What *is* reused, unchanged:

- `AiToolDefinition` / `registerMcpTool` / the `<module>/ai-tools.ts` convention.
- `defineApiBackedAiTool` → `createAiApiOperationRunner`, which invokes the **real** Task
  route handlers in-process with a trusted auth envelope. Commands, validators, events,
  mutation guards, optimistic locking and action-log auditing therefore all still run.
- `RbacService.getGrantedFeatures()` — entitlement-aware and organization-scope-aware, so
  module gating and org scoping are inherited rather than reimplemented.
- `signJwt` / `verifyJwt` from `@open-mercato/shared/lib/auth/jwt` for access tokens.
- `AccessLogService` for the audit trail; `checkRateLimit` for throttling.

## Architecture

```
MCP client
  → GET /.well-known/oauth-protected-resource[/api/mcp/tasks]   (RFC 9728)
  → GET /.well-known/oauth-authorization-server                 (RFC 8414)
  → GET /api/mcp/oauth/authorize   (staff session required; consent + org binding)
  → POST /api/mcp/oauth/token      (PKCE S256 verify; rotating refresh tokens)
  → POST /api/mcp/tasks            (Streamable HTTP, stateless JSON, Bearer required)
```

### Access tokens

HS256 JWT signed with a key derived from `JWT_SECRET` under the **`mcp` audience label**,
so a staff session cookie can never be replayed as an MCP token and vice versa. Claims:
`iss`, `aud` (= the canonical resource URL, RFC 8707), `sub`, `exp`, `iat`, `jti`,
`token_use: 'mcp_access'`, `scope`, `client_id`, `tenant_id`, `organization_id`.
Verification is a real signature check (`verifyJwt` with explicit secret + audience +
issuer), never a bare decode, and the legacy raw-secret fallback is bypassed.

### The four independent gates (all must pass)

1. **OAuth scope** — token must carry `tasks:read` (reads) / `tasks:write` (writes).
2. **Open Mercato RBAC** — `tool.requiredFeatures` checked against
   `getGrantedFeatures(userId, scope)`, re-read from the database on every request. A
   token is never a cached permission.
3. **Tenant/organization** — taken from the token, then **re-validated** server-side; the
   client cannot pass `tenantId`/`organizationId` as tool arguments at all.
4. **Module entitlement** — `getGrantedFeatures` returns `[]` for a disabled/withheld
   `tasks` module, so its tools vanish from `tools/list` and fail closed on call.

### Tools (Tasks only)

`tasks_list_projects`, `tasks_list`, `tasks_get`, `tasks_search` (read, `tasks:read`)
`tasks_create`, `tasks_update`, `tasks_set_status` (write, `tasks:write`)

No delete tool: task deletion stays out of the MCP surface deliberately.

## Non-goals

- MCP protocol "Tasks" extension (long-running operation semantics) — unrelated to the
  ERP entity that happens to share the name.
- Replacing the existing stdio/dev MCP servers.
