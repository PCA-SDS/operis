import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import {
  CatalogProduct,
  CatalogProductPrice,
} from '../data/entities'
import type { CatalogPricingService } from '../services/catalogPricingService'
import type { PriceRow, PricingContext } from './pricing'

/** Products with this fieldset are treated as bookable spa/service offerings. */
export const BOOKABLE_SERVICE_FIELDSET = 'service_schedule'
export const BOOKABLE_DURATION_FIELD_KEY = 'service_duration_minutes'

export type BookableServiceScope = {
  tenantId: string
  organizationId: string
}

export type BookableServiceDeps = {
  pricingService: CatalogPricingService
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

async function assertBookableServiceScope(
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

function toDurationMinutes(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Lists active bookable services for one organization (branch).
 * Staff create/enable services in Catalog UI under that org with fieldset `service_schedule`.
 * Demo seed: `seedExamples` creates Signature Haircut / Restorative Massage per org.
 */
export async function listBookableServicesForOrganization(
  em: EntityManager,
  scope: BookableServiceScope,
  deps: BookableServiceDeps,
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
  const [prices, customFieldsByProductId, channelId] = await Promise.all([
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
    loadCustomFieldValues({
      em,
      entityId: E.catalog.catalog_product,
      recordIds: productIds,
      tenantIdByRecord: Object.fromEntries(productIds.map((id) => [id, scope.tenantId])),
      organizationIdByRecord: Object.fromEntries(productIds.map((id) => [id, scope.organizationId])),
      tenantFallbacks: [scope.tenantId],
    }),
    resolveOrganizationChannelId(em, scope),
  ])

  const pricesByProductId = new Map<string, PriceRow[]>()
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

  // Quote-only products carry no public price, matching the catalog products API.
  const pricedProducts = products.filter((product) => !product.isQuoteOnly)
  const displayPrices = await deps.pricingService.resolvePriceMany(
    pricedProducts.map((product) => ({
      rows: pricesByProductId.get(product.id) ?? [],
      context: pricingContext,
    })),
  )
  const displayPriceByProductId = new Map(
    pricedProducts.map((product, index) => [product.id, displayPrices[index] ?? null]),
  )

  return products.map((product) => {
    const displayPrice = displayPriceByProductId.get(product.id) ?? null
    return {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle ?? null,
      description: product.description ?? null,
      handle: product.handle ?? null,
      currencyCode: displayPrice?.currencyCode ?? product.primaryCurrencyCode ?? null,
      unitPriceNet: displayPrice?.unitPriceNet ?? null,
      unitPriceGross: displayPrice?.unitPriceGross ?? null,
      durationMinutes: toDurationMinutes(
        customFieldsByProductId[product.id]?.[`cf_${BOOKABLE_DURATION_FIELD_KEY}`],
      ),
      organizationId: product.organizationId,
      tenantId: product.tenantId,
    }
  })
}
