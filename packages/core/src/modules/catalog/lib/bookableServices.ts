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
  CatalogProductVariant,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductOptionGroup,
  CatalogProductOption,
} from '../data/entities'
import type { CatalogPricingService } from '../services/catalogPricingService'
import type { PriceRow, PricingContext } from './pricing'

/** Products with this fieldset are treated as bookable spa/service offerings. */
export const BOOKABLE_SERVICE_FIELDSET = 'service_schedule'
export const BOOKABLE_DURATION_FIELD_KEY = 'service_duration_minutes'

export type BookableServiceScope = {
  tenantId: string
  /** Optional branch scope. Phase 1 public booking can list the tenant-wide service set without this. */
  organizationId?: string | null
  /** Optional pricing channel, matching the `channelId` the products API accepts. */
  channelId?: string | null
}

export type BookableServiceDeps = {
  pricingService: CatalogPricingService
}

export type BookableServiceCategory = {
  id: string
  name: string
  description: string | null
  parentId: string | null
}

export type BookableServiceOption = {
  id: string
  code: string | null
  name: string
  description: string | null
  priceFlat: string | null
  durationMinutes: number | null
  isAddon: boolean
  nextGroups: BookableServiceOptionGroup[]
}

export type BookableServiceOptionGroup = {
  id: string
  name: string
  description: string | null
  requirement: 'required' | 'optional'
  selectMode: 'single' | 'multiple'
  options: BookableServiceOption[]
}

export type BookableService = {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  handle: string | null
  sku: string | null
  /** Root first, assigned category last. Only active categories in this scope. */
  categoryPath: BookableServiceCategory[]
  currencyCode: string | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  durationMinutes: number | null
  categoryId: string | null
  categoryName: string | null
  organizationId: string
  tenantId: string
  optionGroups: BookableServiceOptionGroup[]
}

async function resolveBookableCatalogOrganizationIds(
  em: EntityManager,
  scope: BookableServiceScope,
): Promise<string[] | null> {
  const tenant = await em.findOne(Tenant, { id: scope.tenantId, isActive: true, deletedAt: null })
  if (!tenant) {
    throw new CrudHttpError(404, { error: 'Tenant not found.', code: 'TENANT_NOT_FOUND' })
  }

  if (!scope.organizationId) return null

  const organization = await em.findOne(Organization, {
    id: scope.organizationId,
    tenant: scope.tenantId,
    isActive: true,
    deletedAt: null,
  })
  if (!organization) {
    throw new CrudHttpError(404, { error: 'Organization not found.', code: 'ORGANIZATION_NOT_FOUND' })
  }

  const ancestorIds = Array.isArray(organization.ancestorIds)
    ? organization.ancestorIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  return [...new Set([scope.organizationId, ...ancestorIds])]
}

/**
 * Picks the channel whose prices apply to this listing.
 *
 * A caller that knows its channel says so. Otherwise the organization's single
 * active channel is used — the one-channel-per-branch shape `seedExamples`
 * creates, where channel-scoped prices are unambiguous. An organization selling
 * through several channels gets no channel rather than an arbitrary one: only
 * unscoped prices then apply, and the caller can name a channel to see the rest.
 */
async function resolvePricingChannelId(
  em: EntityManager,
  scope: BookableServiceScope,
): Promise<string | null> {
  if (!scope.organizationId) return null

  const where = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    isActive: true,
    deletedAt: null,
  }

  if (scope.channelId) {
    const requested = await em.findOne(SalesChannel, { ...where, id: scope.channelId })
    if (!requested) {
      throw new CrudHttpError(404, { error: 'Sales channel not found.', code: 'CHANNEL_NOT_FOUND' })
    }
    return requested.id
  }

  const channels = await em.find(SalesChannel, where, { limit: 2, orderBy: { createdAt: 'asc' } })
  return channels.length === 1 ? channels[0].id : null
}

function toDurationMinutes(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function variantDurationMinutes(variant: CatalogProductVariant | null | undefined): number | null {
  if (!variant) return null
  const unit = typeof variant.durationUnit === 'string' ? variant.durationUnit.toLowerCase() : 'min'
  const value = variant.durationValue ?? variant.durationMin ?? null
  if (!Number.isInteger(value) || !value || value <= 0) return null
  if (unit === 'hour' || unit === 'hours' || unit === 'h') return value * 60
  return value
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
  const catalogOrganizationIds = await resolveBookableCatalogOrganizationIds(em, scope)

  const scopedWhere = catalogOrganizationIds ? { organizationId: { $in: catalogOrganizationIds } } : {}
  const decryptScope = { tenantId: scope.tenantId }

  // Phase 1 public booking can list the tenant-wide service catalog; organization scoping is optional.
  const [products, channelId] = await Promise.all([
    findWithDecryption(
      em,
      CatalogProduct,
      {
        tenantId: scope.tenantId,
        ...scopedWhere,
        isActive: true,
        deletedAt: null,
        $or: [
          { customFieldsetCode: BOOKABLE_SERVICE_FIELDSET },
          { productType: 'service' },
        ],
      } as Record<string, unknown>,
      { orderBy: { title: 'asc' } },
      decryptScope,
    ),
    resolvePricingChannelId(em, scope),
  ])

  if (!products.length) return []

  const productIds = products.map((product) => product.id)
  const categoryScope = {
    tenantId: scope.tenantId,
    ...scopedWhere,
  }
  const [prices, customFieldsByProductId, defaultVariants, categories, assignments, optionGroups, options] = await Promise.all([
    findWithDecryption(
      em,
      CatalogProductPrice,
      {
        tenantId: scope.tenantId,
        ...scopedWhere,
        product: { $in: productIds },
      },
      { orderBy: { createdAt: 'asc' }, populate: ['offer', 'priceKind', 'variant'] as const },
      decryptScope,
    ),
    loadCustomFieldValues({
      em,
      entityId: E.catalog.catalog_product,
      recordIds: productIds,
      tenantIdByRecord: Object.fromEntries(productIds.map((id) => [id, scope.tenantId])),
      organizationIdByRecord: Object.fromEntries(productIds.map((id) => [id, scope.organizationId ?? null])),
      tenantFallbacks: [scope.tenantId],
    }),
    findWithDecryption(
      em,
      CatalogProductVariant,
      {
        tenantId: scope.tenantId,
        ...scopedWhere,
        product: { $in: productIds },
        isActive: true,
        isDefault: true,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'asc' } },
      decryptScope,
    ),
    findWithDecryption(em, CatalogProductCategory,
      { ...categoryScope, isActive: true, deletedAt: null },
      { orderBy: { name: 'asc', id: 'asc' } }, decryptScope),
    findWithDecryption(em, CatalogProductCategoryAssignment,
      { ...categoryScope, product: { $in: productIds } },
      { orderBy: { position: 'asc', id: 'asc' } }, decryptScope),
    em.find(CatalogProductOptionGroup, 
      { ...categoryScope, product: { $in: productIds }, isActive: true, deletedAt: null },
      { orderBy: { sortOrder: 'asc', id: 'asc' } }
    ),
    em.find(CatalogProductOption,
      { ...categoryScope, group: { product: { $in: productIds } }, isActive: true, deletedAt: null },
      { orderBy: { sortOrder: 'asc', id: 'asc' } }
    ),
  ])

  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const categoryPathByProductId = new Map<string, BookableServiceCategory[]>()
  for (const assignment of assignments) {
    const productId = typeof assignment.product === 'string' ? assignment.product : assignment.product.id
    if (categoryPathByProductId.has(productId)) continue
    const categoryId = typeof assignment.category === 'string' ? assignment.category : assignment.category.id
    const path: BookableServiceCategory[] = []
    const visited = new Set<string>()
    let category = categoriesById.get(categoryId)
    while (category && !visited.has(category.id)) {
      visited.add(category.id)
      path.unshift({ id: category.id, name: category.name, description: category.description ?? null, parentId: category.parentId ?? null })
      if (!category.parentId) break
      category = categoriesById.get(category.parentId)
    }
    // Do not promote an orphan, inactive or out-of-scope ancestor into a root tab.
    if (path.length && path[0].parentId === null) categoryPathByProductId.set(productId, path)
  }

  const defaultVariantByProductId = new Map<string, CatalogProductVariant>()
  for (const variant of defaultVariants) {
    const productRef = variant.product
    const productId =
      typeof productRef === 'string' ? productRef : productRef?.id ?? null
    if (productId && !defaultVariantByProductId.has(productId)) {
      defaultVariantByProductId.set(productId, variant)
    }
  }

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

  // Build the option tree
  const optionsByGroupId = new Map<string, CatalogProductOption[]>()
  for (const opt of options) {
    const groupId = typeof opt.group === 'string' ? opt.group : opt.group.id
    const bucket = optionsByGroupId.get(groupId) ?? []
    bucket.push(opt)
    optionsByGroupId.set(groupId, bucket)
  }

  const groupsByParentOptionId = new Map<string, CatalogProductOptionGroup[]>()
  const rootGroupsByProductId = new Map<string, CatalogProductOptionGroup[]>()

  for (const group of optionGroups) {
    if (group.parentOption) {
      const parentOptId = typeof group.parentOption === 'string' ? group.parentOption : group.parentOption.id
      const bucket = groupsByParentOptionId.get(parentOptId) ?? []
      bucket.push(group)
      groupsByParentOptionId.set(parentOptId, bucket)
    } else {
      const productId = typeof group.product === 'string' ? group.product : group.product.id
      const bucket = rootGroupsByProductId.get(productId) ?? []
      bucket.push(group)
      rootGroupsByProductId.set(productId, bucket)
    }
  }

  function buildOptionTree(group: CatalogProductOptionGroup): BookableServiceOptionGroup {
    const groupOptions = optionsByGroupId.get(group.id) ?? []
    return {
      id: group.id,
      name: group.name,
      description: group.description ?? null,
      requirement: group.requirement,
      selectMode: group.selectMode,
      options: groupOptions.map((opt) => ({
        id: opt.id,
        code: opt.code ?? null,
        name: opt.name,
        description: opt.description ?? null,
        priceFlat: opt.priceFlat ?? null,
        durationMinutes: opt.durationValue ?? null,
        isAddon: opt.isAddon,
        nextGroups: (groupsByParentOptionId.get(opt.id) ?? []).map(buildOptionTree),
      })),
    }
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
    const categoryPath = categoryPathByProductId.get(product.id) ?? []
    const category = categoryPath[categoryPath.length - 1]
    const defaultVariant = defaultVariantByProductId.get(product.id) ?? null
    const customFieldDuration = toDurationMinutes(
      customFieldsByProductId[product.id]?.[`cf_${BOOKABLE_DURATION_FIELD_KEY}`],
    )
    
    return {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle ?? null,
      description: product.description ?? null,
      handle: product.handle ?? null,
      sku: product.sku ?? null,
      categoryPath,
      currencyCode: displayPrice?.currencyCode ?? product.primaryCurrencyCode ?? null,
      unitPriceNet: displayPrice?.unitPriceNet ?? null,
      unitPriceGross: displayPrice?.unitPriceGross ?? null,
      durationMinutes: customFieldDuration ?? variantDurationMinutes(defaultVariant),
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      optionGroups: (rootGroupsByProductId.get(product.id) ?? []).map(buildOptionTree),
    }
  })
}
