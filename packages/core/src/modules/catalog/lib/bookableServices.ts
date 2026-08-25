import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import {
  CatalogProduct,
  CatalogProductPrice,
} from '../data/entities'
import { selectBestPrice, type PriceRow, type PricingContext } from './pricing'

/** Products with this fieldset are treated as bookable spa/service offerings. */
export const BOOKABLE_SERVICE_FIELDSET = 'service_schedule'
export const BOOKABLE_DURATION_FIELD_KEY = 'service_duration_minutes'
export const CATALOG_PRODUCT_ENTITY_ID = 'catalog:catalog_product'

export type BookableServiceScope = {
  tenantId: string
  organizationId: string
}

export type BookableService = {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  handle: string | null
  currencyCode: string | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  durationMinutes: number | null
  organizationId: string
  tenantId: string
}

export async function assertBookableServiceScope(
  em: EntityManager,
  scope: BookableServiceScope,
): Promise<void> {
  const tenant = await em.findOne(Tenant, { id: scope.tenantId, isActive: true, deletedAt: null })
  if (!tenant) {
    throw new CrudHttpError(404, { error: 'Tenant not found.', code: 'TENANT_NOT_FOUND' })
  }

  const organization = await em.findOne(Organization, {
    id: scope.organizationId,
    tenant: scope.tenantId,
    isActive: true,
    deletedAt: null,
  })
  if (!organization) {
    throw new CrudHttpError(404, { error: 'Organization not found.', code: 'ORGANIZATION_NOT_FOUND' })
  }
}

async function resolveOrganizationChannelId(
  em: EntityManager,
  scope: BookableServiceScope,
): Promise<string | null> {
  const channel = await em.findOne(
    SalesChannel,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'asc' } },
  )
  return channel?.id ?? null
}

function toPriceRows(prices: CatalogProductPrice[]): PriceRow[] {
  return prices as PriceRow[]
}

function pickDisplayPrice(
  prices: CatalogProductPrice[],
  pricingContext: PricingContext,
): CatalogProductPrice | null {
  if (!prices.length) return null
  const best = selectBestPrice(toPriceRows(prices), pricingContext)
  if (best) return best
  // Booking list may run without a channel; fall back to the oldest unscoped / any price.
  const unscoped = prices.find((row) => !row.channelId && !row.offer)
  return unscoped ?? prices[0] ?? null
}

async function loadDurationMinutesByProductId(
  em: EntityManager,
  scope: BookableServiceScope,
  productIds: string[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>()
  for (const id of productIds) result.set(id, null)
  if (!productIds.length) return result

  const values = await em.find(CustomFieldValue, {
    entityId: CATALOG_PRODUCT_ENTITY_ID,
    recordId: { $in: productIds },
    fieldKey: BOOKABLE_DURATION_FIELD_KEY,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  for (const row of values) {
    if (row.organizationId && row.organizationId !== scope.organizationId) continue
    if (typeof row.valueInt === 'number' && Number.isFinite(row.valueInt)) {
      result.set(row.recordId, row.valueInt)
    }
  }
  return result
}

/**
 * Lists active bookable services for one organization (branch).
 * Staff create/enable services in Catalog UI under that org with fieldset `service_schedule`.
 * Demo seed: `seedExamples` creates Signature Haircut / Restorative Massage per org.
 */
export async function listBookableServicesForOrganization(
  em: EntityManager,
  scope: BookableServiceScope,
): Promise<BookableService[]> {
  await assertBookableServiceScope(em, scope)

  const products = await findWithDecryption(
    em,
    CatalogProduct,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      deletedAt: null,
      customFieldsetCode: BOOKABLE_SERVICE_FIELDSET,
    },
    { orderBy: { title: 'asc' } },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )

  if (!products.length) return []

  const productIds = products.map((product) => product.id)
  const [prices, durationByProductId, channelId] = await Promise.all([
    findWithDecryption(
      em,
      CatalogProductPrice,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        product: { $in: productIds },
      },
      { orderBy: { createdAt: 'asc' }, populate: ['offer', 'priceKind', 'variant'] as const },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    ),
    loadDurationMinutesByProductId(em, scope, productIds),
    resolveOrganizationChannelId(em, scope),
  ])

  const pricesByProductId = new Map<string, CatalogProductPrice[]>()
  for (const price of prices) {
    const productRef = price.product
    const productId =
      typeof productRef === 'string' ? productRef : productRef?.id ?? null
    if (!productId) continue
    const bucket = pricesByProductId.get(productId) ?? []
    bucket.push(price)
    pricesByProductId.set(productId, bucket)
  }

  const pricingContext: PricingContext = {
    channelId,
    quantity: 1,
    date: new Date(),
  }

  return products.map((product) => {
    const displayPrice = pickDisplayPrice(pricesByProductId.get(product.id) ?? [], pricingContext)
    return {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle ?? null,
      description: product.description ?? null,
      handle: product.handle ?? null,
      currencyCode: displayPrice?.currencyCode ?? product.primaryCurrencyCode ?? null,
      unitPriceNet: displayPrice?.unitPriceNet ?? null,
      unitPriceGross: displayPrice?.unitPriceGross ?? null,
      durationMinutes: durationByProductId.get(product.id) ?? null,
      organizationId: product.organizationId,
      tenantId: product.tenantId,
    }
  })
}
