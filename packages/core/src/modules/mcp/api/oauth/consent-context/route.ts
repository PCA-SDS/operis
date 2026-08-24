import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { listSelectableOrganizations, verifyAuthorizationRequest } from '../../../lib/consent'
import { getMcpScope } from '../../../lib/scope-registry'
import { oauthErrorResponse } from '../../../lib/errors'
import { ensureMcpScopesRegistered } from '../../../lib/bootstrap'

export const metadata = {
  GET: { requireAuth: true },
}

const querySchema = z.object({ request: z.string().min(1).max(8192) })

/**
 * Everything the consent screen needs to render, resolved server-side.
 *
 * The browser only ever holds the opaque signed ticket; the client name, the
 * scope descriptions and — critically — the list of organizations the user may
 * bind come from here, so the page cannot present or submit an option the
 * server would not accept.
 */
export async function GET(req: Request) {
  await ensureMcpScopesRegistered()

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ request: url.searchParams.get('request') ?? '' })
  if (!parsed.success) return oauthErrorResponse('invalid_request')

  const ticket = verifyAuthorizationRequest(parsed.data.request)
  if (!ticket) return oauthErrorResponse('invalid_request')

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return oauthErrorResponse('access_denied', { status: 401 })

  // The ticket is bound to the session that started the flow.
  if (auth.sub !== ticket.userId || auth.tenantId !== ticket.tenantId) {
    return oauthErrorResponse('access_denied')
  }

  const container = await createRequestContainer()
  const organizations = await listSelectableOrganizations(container, auth.sub, auth.tenantId)

  return NextResponse.json(
    {
      clientName: ticket.clientName,
      clientId: ticket.clientId,
      redirectUri: ticket.redirectUri,
      scopes: ticket.scopes.map((scope) => ({
        scope,
        description: getMcpScope(scope)?.description ?? scope,
      })),
      organizations,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
