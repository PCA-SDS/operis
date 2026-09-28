import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveEffectiveWarrantyClaimSettings } from '../../../../lib/settings'
import { computeWarrantyEntitlementPreview } from '../../../../lib/warrantyPreview'
import type { WarrantyClaimWarrantyStatus } from '../../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { toIsoOrEcho } from '@open-mercato/shared/lib/date/normalize'
import { type PortalOrdersContext, amountField, resolvePortalOrdersContext } from '../shared'
import { isMissingTableError } from '../../../../lib/dbErrors'
import { readStringField } from '@open-mercato/shared/lib/string'

const logger = createLogger('warranty_claims')

const querySchema = z
  .object({
    orderId: z.string().uuid(),
  })
  .strict()

const orderSchema = z.object({
  id: z.string().uuid(),
  placedAt: z.string().nullable(),
})

const orderLineSchema = z.object({
  orderLineId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  name: z.string().nullable(),
  quantity: z.union([z.string(), z.number()]).nullable(),
  estimatedWarrantyStatus: z.enum(['in_warranty', 'out_of_warranty', 'unknown']),
  // Warranty basis for the line so the claim persists real entitlement metadata (WQA-004).
  purchaseDate: z.string().nullable(),
  warrantyMonths: z.number().nullable(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  order: orderSchema,
  items: z.array(orderLineSchema),
})

type OwnedOrder = {
  id: string
  placedAt: string | null
}

type PortalOrderLineItem = z.infer<typeof orderLineSchema>

export const metadata = {
  GET: { requireAuth: false },
}

function estimateWarrantyStatus(placedAt: string | null, defaultWarrantyMonths: number | null): WarrantyClaimWarrantyStatus {
  if (!placedAt) return 'unknown'
  return computeWarrantyEntitlementPreview(new Date(placedAt), defaultWarrantyMonths)
}

type PortalOrderLinesDb = {
  sales_orders: {
    id: string
    placed_at: Date | null
    customer_entity_id: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  sales_order_lines: {
    id: string
    order_id: string
    kind: string | null
    product_id: string | null
    product_variant_id: string | null
    catalog_snapshot: Record<string, unknown> | null
    name: string | null
    quantity: string | number | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

async function loadOwnedOrder(
  context: PortalOrdersContext,
  orderId: string,
): Promise<OwnedOrder | null> {
  try {
    const db = context.em.getKysely<PortalOrderLinesDb>()
    const row = await db
      .selectFrom('sales_orders')
      .select(['id', 'placed_at'])
      .where('id', '=', orderId)
      .where('tenant_id', '=', context.tenantId)
      .where('organization_id', '=', context.organizationId)
      .where('customer_entity_id', '=', context.customerId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (!row) return null
    return { id: row.id, placedAt: toIsoOrEcho(row.placed_at) }
  } catch (err) {
    if (isMissingTableError(err)) return null
    throw err
  }
}

function serializeOrderLine(
  row: Record<string, unknown>,
  estimatedWarrantyStatus: WarrantyClaimWarrantyStatus,
  purchaseDate: string | null,
  warrantyMonths: number | null,
): PortalOrderLineItem | null {
  if (readStringField(row, 'kind') !== 'product') return null
  const id = readStringField(row, 'id')
  if (!id) return null
  const snapshot = row.catalog_snapshot && typeof row.catalog_snapshot === 'object' && !Array.isArray(row.catalog_snapshot)
    ? row.catalog_snapshot as Record<string, unknown>
    : {}
  return {
    orderLineId: id,
    productId: readStringField(row, 'product_id'),
    variantId: readStringField(row, 'product_variant_id'),
    sku: readStringField(row, 'sku') ?? readStringField(snapshot, 'sku') ?? readStringField(snapshot, 'variantSku') ?? readStringField(snapshot, 'variant_sku'),
    name: readStringField(row, 'name') ?? readStringField(snapshot, 'title') ?? readStringField(snapshot, 'name'),
    quantity: amountField(row, 'quantity'),
    estimatedWarrantyStatus,
    purchaseDate,
    warrantyMonths,
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const contextOrResponse = await resolvePortalOrdersContext(req)
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse
    const { translate } = await resolveTranslations()
    const order = await loadOwnedOrder(context, query.orderId)
    if (!order) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.orderNotOwned', 'Order not found') }, { status: 404 })
    }

    const settings = await resolveEffectiveWarrantyClaimSettings(context.em, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const estimatedWarrantyStatus = estimateWarrantyStatus(order.placedAt, settings.defaultWarrantyMonths)
    const db = context.em.getKysely<PortalOrderLinesDb>()
    let rows: Array<Record<string, unknown>> = []
    try {
      rows = await db
        .selectFrom('sales_order_lines')
        .select(['id', 'order_id', 'kind', 'product_id', 'product_variant_id', 'catalog_snapshot', 'name', 'quantity'])
        .where('order_id', '=', order.id)
        .where('tenant_id', '=', context.tenantId)
        .where('organization_id', '=', context.organizationId)
        .where('deleted_at', 'is', null)
        .limit(100)
        .execute() as Array<Record<string, unknown>>
    } catch (err) {
      if (!isMissingTableError(err)) throw err
    }

    return NextResponse.json({
      ok: true,
      order,
      items: rows
        .map((row) => serializeOrderLine(row, estimatedWarrantyStatus, order.placedAt, settings.defaultWarrantyMonths))
        .filter((item): item is PortalOrderLineItem => item !== null),
    })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.portal.order_lines.get failed', { err })
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim order line picker',
  methods: {
    GET: {
      summary: 'List product lines for an authenticated customer-owned order',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Customer-owned sales order product lines',
          schema: responseSchema,
        },
      ],
    },
  },
}
