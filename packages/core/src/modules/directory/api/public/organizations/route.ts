import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { publicCorsHeaders, withPublicCorsHeaders } from '@open-mercato/shared/lib/http/cors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, getClientIp, RATE_LIMIT_FALLBACK_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

export const metadata = {
  GET: { requireAuth: false },
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: publicCorsHeaders(req) })
}

const querySchema = z.object({
  tenantId: z.string().uuid(),
})

// Unauthenticated and unbounded — it returns every active organization for the supplied
// tenant with no pagination. The sibling public route
// (`appointments/api/public/customer`) is limited; this one was not.
const publicOrganizationsRateLimitConfig = readEndpointRateLimitConfig('DIRECTORY_PUBLIC_ORGANIZATIONS', {
  points: 30,
  duration: 60,
  blockDuration: 300,
  keyPrefix: 'directory_public_organizations',
})

export async function GET(req: Request) {
  const rateLimiterService = getCachedRateLimiterService()
  if (rateLimiterService) {
    const { translate } = await resolveTranslations()
    const clientIp = getClientIp(req, rateLimiterService.trustProxyDepth)
    const rateLimitResponse = await checkRateLimit(
      rateLimiterService,
      publicOrganizationsRateLimitConfig,
      clientIp ?? RATE_LIMIT_FALLBACK_KEY,
      translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
    )
    if (rateLimitResponse) return withPublicCorsHeaders(rateLimitResponse, req)
  }

  const parsed = querySchema.safeParse({
    tenantId: new URL(req.url).searchParams.get('tenantId'),
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], error: 'Invalid tenantId.' }, { status: 400, headers: publicCorsHeaders(req) })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const organizations = await em.find(Organization, {
    tenant: parsed.data.tenantId,
    isActive: true,
    deletedAt: null,
  }, { orderBy: { name: 'asc', id: 'asc' } })

  return NextResponse.json({
    items: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      parentId: organization.parentId ?? null,
      rootId: organization.rootId ?? null,
      depth: organization.depth,
    })),
  }, { headers: publicCorsHeaders(req) })
}
