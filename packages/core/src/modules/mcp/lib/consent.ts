import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { signJwt, verifyJwt, deriveJwtAudienceSecret } from '@open-mercato/shared/lib/auth/jwt'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'

/**
 * Audience label for the short-lived token that carries a *validated*
 * authorization request from `/authorize` to the consent screen and back.
 *
 * Without it the consent form would have to round-trip the raw OAuth parameters
 * through the browser, letting a user (or a script on the page) rewrite the
 * redirect URI or widen the scope between validation and code issuance. Signing
 * them means the decision endpoint re-reads exactly what `/authorize` approved.
 */
const CONSENT_AUDIENCE = 'mcp_consent'
const CONSENT_TTL_SECONDS = 600

export type AuthorizationRequestPayload = {
  clientId: string
  clientName: string
  redirectUri: string
  scopes: string[]
  state: string | null
  codeChallenge: string
  resource: string
  /** Binds the ticket to the signed-in user who was validated at /authorize. */
  userId: string
  tenantId: string
}

function consentSecret(): string {
  return deriveJwtAudienceSecret(CONSENT_AUDIENCE)
}

export function signAuthorizationRequest(payload: AuthorizationRequestPayload): string {
  return signJwt(
    {
      client_id: payload.clientId,
      client_name: payload.clientName,
      redirect_uri: payload.redirectUri,
      scopes: payload.scopes,
      state: payload.state,
      code_challenge: payload.codeChallenge,
      resource: payload.resource,
      sub: payload.userId,
      tenant_id: payload.tenantId,
    },
    {
      secret: consentSecret(),
      audience: CONSENT_AUDIENCE,
      issuer: CONSENT_AUDIENCE,
      expiresInSec: CONSENT_TTL_SECONDS,
    },
  )
}

export function verifyAuthorizationRequest(token: string): AuthorizationRequestPayload | null {
  const payload = verifyJwt(token, {
    secret: consentSecret(),
    audience: CONSENT_AUDIENCE,
    issuer: CONSENT_AUDIENCE,
  })
  if (!payload) return null

  const scopes = Array.isArray(payload.scopes)
    ? payload.scopes.filter((entry: unknown): entry is string => typeof entry === 'string')
    : []

  if (
    typeof payload.client_id !== 'string' ||
    typeof payload.redirect_uri !== 'string' ||
    typeof payload.code_challenge !== 'string' ||
    typeof payload.resource !== 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.tenant_id !== 'string' ||
    scopes.length === 0
  ) {
    return null
  }

  return {
    clientId: payload.client_id,
    clientName: typeof payload.client_name === 'string' ? payload.client_name : payload.client_id,
    redirectUri: payload.redirect_uri,
    scopes,
    state: typeof payload.state === 'string' ? payload.state : null,
    codeChallenge: payload.code_challenge,
    resource: payload.resource,
    userId: payload.sub,
    tenantId: payload.tenant_id,
  }
}

export type SelectableOrganization = { id: string; name: string }

/**
 * Organizations this user may bind an MCP connection to.
 *
 * The list is derived server-side from live membership — it is the *only* source
 * the authorize flow accepts. A user who belongs to several organizations picks
 * one here, and that choice is what ends up in the token; nothing downstream ever
 * takes an organization id from the client.
 */
export async function listSelectableOrganizations(
  container: AwilixContainer,
  userId: string,
  tenantId: string,
): Promise<SelectableOrganization[]> {
  const em = container.resolve<EntityManager>('em')
  const rbac = container.resolve<RbacService>('rbacService')

  const scope = await resolveOrganizationScope({
    em,
    rbac,
    auth: { sub: userId, userId, tenantId, orgId: null, isSuperAdmin: false },
    tenantId,
  })

  const allowedIds = scope.allowedIds
  const organizations = await em.find(
    Organization,
    {
      tenant: tenantId,
      deletedAt: null,
      ...(allowedIds && allowedIds.length > 0 ? { id: { $in: allowedIds } } : {}),
    },
    { orderBy: { name: 'asc' }, limit: 200 },
  )

  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
  }))
}

/**
 * Re-check a chosen organization against live membership.
 *
 * Called at the moment the code is issued, not just when the picker was rendered,
 * so a membership revoked mid-flow cannot be captured into a token.
 */
export async function assertOrganizationSelectable(
  container: AwilixContainer,
  userId: string,
  tenantId: string,
  organizationId: string,
): Promise<boolean> {
  const options = await listSelectableOrganizations(container, userId, tenantId)
  return options.some((option) => option.id === organizationId)
}
