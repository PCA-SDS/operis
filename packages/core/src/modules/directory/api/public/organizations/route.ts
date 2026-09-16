import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { publicCorsHeaders } from '@open-mercato/shared/lib/http/cors'
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

export async function GET(req: Request) {
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
