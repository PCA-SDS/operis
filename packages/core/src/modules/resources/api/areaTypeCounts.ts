import type { Kysely } from 'kysely'
import { sql as ksql } from 'kysely'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

type AreaCountDatabase = {
  resources_resource_areas: {
    area_type_id: string | null
    deleted_at: Date | null
    tenant_id: string | null
    organization_id: string | null
  }
}

type KyselyCapableEntityManager = { getKysely: () => Kysely<AreaCountDatabase> }

type AreaTypeCountContext = Pick<
  CrudCtx,
  'container' | 'auth' | 'organizationScope' | 'organizationIds' | 'selectedOrganizationId'
> & { query?: { withAreaCounts?: unknown } }

type AreaTypeListPayload = { items?: unknown } | null | undefined

type AreaCountRow = { area_type_id: string | null; count: string | number }

export async function attachAreaTypeCounts(
  payload: AreaTypeListPayload,
  ctx: AreaTypeCountContext,
): Promise<void> {
  if (!parseBooleanFromUnknown(ctx.query?.withAreaCounts)) return

  const items = Array.isArray(payload?.items)
    ? (payload!.items as Array<Record<string, unknown>>)
    : []
  if (!items.length) return

  const typeIds = items
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!typeIds.length) return

  const tenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null
  const orgIds = ctx.organizationIds ?? ctx.organizationScope?.filterIds ?? null
  const singleOrgId = ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null

  const db = (ctx.container.resolve('em') as unknown as KyselyCapableEntityManager).getKysely()
  let query = db
    .selectFrom('resources_resource_areas')
    .select(['area_type_id', ksql<string>`count(*)`.as('count')])
    .where('area_type_id', 'in', typeIds)
    .where('deleted_at', 'is', null)
  if (tenantId) query = query.where('tenant_id', '=', tenantId)
  if (Array.isArray(orgIds) && orgIds.length > 0) {
    query = query.where('organization_id', 'in', orgIds)
  } else if (singleOrgId) {
    query = query.where('organization_id', '=', singleOrgId)
  }
  const rows = (await query.groupBy('area_type_id').execute()) as unknown as AreaCountRow[]

  const countMap = new Map<string, number>()
  for (const row of rows) {
    if (typeof row.area_type_id !== 'string') continue
    const count = typeof row.count === 'string' ? Number.parseInt(row.count, 10) : Number(row.count)
    countMap.set(row.area_type_id, Number.isFinite(count) ? count : 0)
  }
  for (const item of items) {
    if (typeof item.id !== 'string') continue
    item.areaCount = countMap.get(item.id) ?? 0
  }
}
