import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { searchPeopleForBooking } from '@open-mercato/core/modules/customers/lib/personLookup'

const querySchema = z.object({ search: z.string().trim().min(2).max(64) })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['appointments.view'] },
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: translate('appointments.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ items: [] })

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const items = await searchPeopleForBooking(em, { tenantId: auth.tenantId }, parsed.data.search)
  return NextResponse.json({ items })
}
