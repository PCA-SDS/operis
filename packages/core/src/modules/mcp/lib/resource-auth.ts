import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { verifyMcpAccessToken } from './tokens'
import { filterKnownScopes, moduleIdsForScopes } from './scope-registry'
import type { McpConnectionConfig } from './config'

const logger = createLogger('mcp').child({ component: 'resource-auth' })

export type McpAuthFailureReason =
  | 'missing_token'
  | 'malformed_token'
  | 'invalid_token'
  | 'unknown_user'
  | 'organization_denied'
  | 'module_unavailable'
  | 'no_effective_scopes'

export type McpAuthenticatedContext = {
  userId: string
  tenantId: string
  organizationId: string
  clientId: string
  tokenId: string
  /** Scopes the token carries, narrowed to those this deployment defines. */
  scopes: string[]
  /**
   * Features re-read from the database on this request. Never taken from the
   * token: a grant revoked after the token was minted must take effect at once.
   */
  grantedFeatures: string[]
}

export type McpAuthResult =
  | { ok: true; context: McpAuthenticatedContext }
  | { ok: false; reason: McpAuthFailureReason }

/**
 * Bearer token, from the Authorization header only.
 *
 * The MCP specification forbids access tokens in query strings, and so does this
 * implementation: URLs end up in logs, proxies and Referer headers.
 */
export function extractBearerToken(headers: Headers): string | null {
  const raw = headers.get('authorization')
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null
  const token = trimmed.slice(7).trim()
  return token.length > 0 ? token : null
}

/**
 * Turn a Bearer token into a fully re-validated execution context.
 *
 * The token is only ever a *claim*. Everything it asserts is checked again
 * against live state before a single tool can run:
 *
 *  1. cryptographic verification (signature, issuer, audience, expiry, token use)
 *  2. the user still exists, is confirmed and is not soft-deleted
 *  3. the user still belongs to the tenant the token names
 *  4. the organization is still one the user may act in
 *  5. the owning module is still entitled, and the user still holds grants
 *
 * Any failure returns a reason for the caller to map onto a coarse response —
 * the reason itself is never sent to the client.
 */
export async function authenticateMcpResourceRequest(
  token: string | null,
  container: AwilixContainer,
  config: McpConnectionConfig,
): Promise<McpAuthResult> {
  if (!token) return { ok: false, reason: 'missing_token' }

  const verification = verifyMcpAccessToken(token, config)
  if (!verification.ok) {
    return {
      ok: false,
      reason: verification.reason === 'malformed' ? 'malformed_token' : 'invalid_token',
    }
  }

  const claims = verification.claims
  const scopes = filterKnownScopes(claims.scope.split(/\s+/).filter(Boolean))
  if (scopes.length === 0) return { ok: false, reason: 'no_effective_scopes' }

  const em = container.resolve<EntityManager>('em')
  const rbac = container.resolve<RbacService>('rbacService')

  // (2) + (3): the subject must still be a live user of that exact tenant. A
  // token outlives a deactivation otherwise.
  const user = await em.findOne(User, {
    id: claims.sub,
    tenantId: claims.tenant_id,
    deletedAt: null,
  })
  if (!user || user.isConfirmed === false) {
    return { ok: false, reason: 'unknown_user' }
  }

  // (4): re-derive the organization scope from live membership and require the
  // token's organization to still be selectable. This is the check that stops a
  // token surviving a user's removal from an organization — and it is why no
  // tool ever accepts an organizationId argument.
  const scope = await resolveOrganizationScope({
    em,
    rbac,
    auth: {
      sub: user.id,
      userId: user.id,
      tenantId: claims.tenant_id,
      orgId: claims.organization_id,
      isSuperAdmin: false,
    },
    selectedId: claims.organization_id,
    tenantId: claims.tenant_id,
  })

  if (
    scope.selectionRejected === true ||
    scope.tenantId !== claims.tenant_id ||
    scope.selectedId !== claims.organization_id
  ) {
    return { ok: false, reason: 'organization_denied' }
  }

  // (5): grants are entitlement-aware, so a tenant that lost the module — or a
  // user it was withheld from — comes back empty and every tool disappears.
  const grantedFeatures = await rbac.getGrantedFeatures(user.id, {
    tenantId: claims.tenant_id,
    organizationId: claims.organization_id,
  })

  if (grantedFeatures.length === 0) {
    return { ok: false, reason: 'module_unavailable' }
  }

  const modules = moduleIdsForScopes(scopes)
  for (const moduleId of modules) {
    const allowed = await rbac.isModuleAllowedForUser(user.id, moduleId, {
      tenantId: claims.tenant_id,
      organizationId: claims.organization_id,
    })
    if (!allowed) {
      logger.info('MCP request denied: module not available for user', { moduleId })
      return { ok: false, reason: 'module_unavailable' }
    }
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      tenantId: claims.tenant_id,
      organizationId: claims.organization_id,
      clientId: claims.client_id,
      tokenId: claims.jti,
      scopes,
      grantedFeatures,
    },
  }
}
