import { NextResponse } from 'next/server'
import { sql } from 'kysely'
import { z } from 'zod'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toIsoOrEcho } from '@open-mercato/shared/lib/date/normalize'
import { amountField, resolvePortalOrdersContext } from './shared'
import { isMissingTableError } from '../../../lib/dbErrors'
import { readStringField } from '@open-mercato/shared/lib/string'

const logger = createLogger('warranty_claims')

const PAGE_SIZE = 20

const querySchema = z
  .object({
    search: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.string().max(120).optional(),
    ),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict()

const orderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  placedAt: z.string().nullable(),
  currencyCode: z.string().nullable(),
  grandTotalGrossAmount: z.union([z.string(), z.number()]).nullable(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  items: z.array(orderSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
})

type PortalOrderItem = z.infer<typeof orderSchema>

export const metadata = {
  GET: { requireAuth: false },
}

type PortalOrdersDb = {
  sales_orders: {
    id: string
    order_number: string
    placed_at: Date | null
    currency_code: string
    grand_total_gross_amount: string | number | null
    customer_entity_id: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

function serializeOrder(row: Record<string, unknown>): PortalOrderItem | null {
  const id = readStringField(row, 'id')
  if (!id) return null
  return {
    id,
    orderNumber: readStringField(row, 'order_number') ?? id,
    placedAt: toIsoOrEcho(row.placed_at),
    currencyCode: readStringField(row, 'currency_code'),
    grandTotalGrossAmount: amountField(row, 'grand_total_gross_amount'),
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const contextOrResponse = await resolvePortalOrdersContext(req)
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse
    const db = context.em.getKysely<PortalOrdersDb>()
    let listQuery = db
      .selectFrom('sales_orders')
      .select(['id', 'order_number', 'placed_at', 'currency_code', 'grand_total_gross_amount'])
      .where('tenant_id', '=', context.tenantId)
      .where('organization_id', '=', context.organizationId)
      .where('customer_entity_id', '=', context.customerId)
      .where('deleted_at', 'is', null)
    let countQuery = db
      .selectFrom('sales_orders')
      .select(sql<string>`count(*)`.as('total'))
      .where('tenant_id', '=', context.tenantId)
      .where('organization_id', '=', context.organizationId)
      .where('customer_entity_id', '=', context.customerId)
      .where('deleted_at', 'is', null)
    if (query.search) {
      const pattern = `%${escapeLikePattern(query.search)}%`
      listQuery = listQuery.where('order_number', 'ilike', pattern)
      countQuery = countQuery.where('order_number', 'ilike', pattern)
    }
    let rows: Array<Record<string, unknown>> = []
    let total = 0
    try {
      rows = await listQuery
        .orderBy('placed_at', 'desc')
        .limit(PAGE_SIZE)
        .offset((query.page - 1) * PAGE_SIZE)
        .execute() as Array<Record<string, unknown>>
      const countRow = await countQuery.executeTakeFirst()
      total = Number(countRow?.total ?? 0) || 0
    } catch (err) {
      if (!isMissingTableError(err)) throw err
    }

    return NextResponse.json({
      ok: true,
      items: rows.map(serializeOrder).filter((item): item is PortalOrderItem => item !== null),
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
    })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.portal.orders.get failed', { err })
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim order picker',
  methods: {
    GET: {
      summary: 'List authenticated customer orders for portal claim intake',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Customer-owned sales orders',
          schema: responseSchema,
        },
      ],
    },
  },
}
