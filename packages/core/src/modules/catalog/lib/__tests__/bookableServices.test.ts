/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { CatalogProduct, CatalogProductPrice, CatalogProductCategory, CatalogProductCategoryAssignment } from '../../data/entities'
import type { CatalogPricingService } from '../../services/catalogPricingService'
import type { PriceRow } from '../pricing'
import {
  BOOKABLE_DURATION_FIELD_KEY,
  BOOKABLE_SERVICE_FIELDSET,
  listBookableServicesForOrganization,
} from '../bookableServices'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG = '44444444-4444-4444-8444-444444444444'
const CHILD_ORG = '55555555-5555-4555-8555-555555555555'

type Fixture = {
  tenant?: boolean
  organization?: boolean
  channelIds?: string[]
  products?: Array<Partial<CatalogProduct> & { id: string; title: string }>
  prices?: Array<Partial<CatalogProductPrice> & { id: string; product: { id: string } }>
  durations?: Record<string, number>
  categories?: Array<Partial<CatalogProductCategory> & { id: string; name: string }>
  assignments?: Array<{ product: { id: string }; category: { id: string }; tenantId: string; organizationId: string }>
}

/**
 * Stands in for the tables the listing reads. Rows are matched on the same
 * scope columns the real queries filter on, so a query that dropped its tenant
 * or organization filter would return another branch's rows and fail the test.
 */
function createEm(fixture: Fixture) {
  const queries: Array<{ entity: unknown; where: Record<string, any> }> = []

  const matchesValue = (rowValue: unknown, whereValue: unknown) => {
    if (whereValue === undefined) return true
    if (whereValue && typeof whereValue === 'object' && '$in' in whereValue) {
      return Array.isArray(whereValue.$in) && whereValue.$in.includes(rowValue)
    }
    return rowValue === whereValue
  }
  const matchesScope = (row: Record<string, any>, where: Record<string, any>) =>
    matchesValue(row.tenantId, where.tenantId) &&
    matchesValue(row.organizationId, where.organizationId)

  const findOne = jest.fn(async (entity: unknown, where: Record<string, any>) => {
    queries.push({ entity, where })
    if (entity === Tenant) {
      return fixture.tenant === false ? null : { id: where.id }
    }
    if (entity === Organization) {
      if (fixture.organization === false) return null
      if (where.tenant !== TENANT) return null
      if (where.id === ORG) return { id: where.id, ancestorIds: [] }
      if (where.id === CHILD_ORG) return { id: where.id, ancestorIds: [ORG] }
      return null
    }
    if (entity === SalesChannel) {
      if (!matchesScope({ tenantId: TENANT, organizationId: ORG }, where)) return null
      const found = (fixture.channelIds ?? []).find((id) => id === where.id)
      return found ? { id: found } : null
    }
    return null
  })

  const find = jest.fn(async (entity: unknown, where: Record<string, any>) => {
    queries.push({ entity, where })
    if (entity === CatalogProduct) {
      return (fixture.products ?? []).filter(
        (product) =>
          matchesScope({ tenantId: TENANT, organizationId: ORG, ...product }, where) &&
          where.isActive === true &&
          where.deletedAt === null &&
          where.$or?.some((filter: Record<string, unknown>) =>
            filter.customFieldsetCode === (product.customFieldsetCode ?? BOOKABLE_SERVICE_FIELDSET) ||
            (filter.productType !== undefined && filter.productType === product.productType)),
      )
    }
    if (entity === CatalogProductPrice) {
      const wanted: string[] = where.product?.$in ?? []
      return (fixture.prices ?? []).filter(
        (price) =>
          matchesScope({ tenantId: TENANT, organizationId: ORG, ...price }, where) &&
          wanted.includes(price.product.id),
      )
    }
    if (entity === CatalogProductCategory) {
      return (fixture.categories ?? []).filter((category) => matchesScope(category, where) && category.isActive !== false && !category.deletedAt)
    }
    if (entity === CatalogProductCategoryAssignment) {
      return (fixture.assignments ?? []).filter((assignment) => matchesScope(assignment, where) && where.product.$in.includes(assignment.product.id))
    }
    if (entity === CustomFieldValue) {
      const wanted: string[] = where.recordId?.$in ?? []
      return Object.entries(fixture.durations ?? {})
        .filter(([recordId]) => wanted.includes(recordId))
        .map(([recordId, minutes]) => ({
          recordId,
          fieldKey: BOOKABLE_DURATION_FIELD_KEY,
          organizationId: ORG,
          tenantId: TENANT,
          valueInt: minutes,
        }))
    }
    if (entity === SalesChannel) {
      if (!matchesScope({ tenantId: TENANT, organizationId: ORG }, where)) return []
      return (fixture.channelIds ?? []).map((id) => ({ id }))
    }
    if (entity === CustomFieldDef) return []
    return []
  })

  return { em: { find, findOne } as unknown as EntityManager, queries }
}

function createPricingService(pick: (rows: PriceRow[]) => PriceRow | null = (rows) => rows[0] ?? null) {
  const resolvePriceMany = jest.fn(async (entries: Array<{ rows: PriceRow[] }>) =>
    entries.map((entry) => pick(entry.rows)),
  )
  return {
    service: { resolvePrice: jest.fn(), resolvePriceMany } as unknown as CatalogPricingService,
    resolvePriceMany,
  }
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    if (!isCrudHttpError(error)) throw error
    return error
  }
}

const service = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  tenantId: TENANT,
  organizationId: ORG,
  isQuoteOnly: false,
  ...extra,
}) as Partial<CatalogProduct> & { id: string; title: string }

const price = (id: string, productId: string, extra: Record<string, unknown> = {}) => ({
  id,
  product: { id: productId },
  tenantId: TENANT,
  organizationId: ORG,
  currencyCode: 'USD',
  unitPriceNet: '95.0000',
  unitPriceGross: '95.0000',
  ...extra,
}) as Partial<CatalogProductPrice> & { id: string; product: { id: string } }

describe('listBookableServicesForOrganization', () => {
  it('returns root-first category ancestry and SKU without leaking another organization', async () => {
    const scoped = { tenantId: TENANT, organizationId: ORG }
    const { em, queries } = createEm({
      products: [service('p1', 'Polish', { sku: 'NAIL-01' }), service('p2', 'Other')],
      categories: [
        { ...scoped, id: 'root', name: 'Nails' },
        { ...scoped, id: 'child', name: 'Manicure', parentId: 'root', description: 'Category note' },
        { ...scoped, organizationId: OTHER_ORG, id: 'foreign', name: 'Private' },
      ],
      assignments: [
        { ...scoped, product: { id: 'p1' }, category: { id: 'child' } },
        { ...scoped, product: { id: 'p2' }, category: { id: 'foreign' } },
      ],
    })
    const { service: pricingService } = createPricingService()
    const items = await listBookableServicesForOrganization(em, scoped, { pricingService })
    expect(items[0]).toMatchObject({ sku: 'NAIL-01', categoryId: 'child', categoryName: 'Manicure', categoryPath: [
      { id: 'root', name: 'Nails', parentId: null, description: null },
      { id: 'child', name: 'Manicure', parentId: 'root', description: 'Category note' },
    ] })
    expect(items[1]).toMatchObject({ categoryPath: [], categoryId: null, categoryName: null })
    for (const entity of [CatalogProductCategory, CatalogProductCategoryAssignment]) {
      expect(queries.find((query) => query.entity === entity)?.where).toMatchObject({
        tenantId: TENANT,
        organizationId: { $in: [ORG] },
      })
    }
  })

  it('rejects an unknown or inactive tenant before reading any catalog data', async () => {
    const { em, queries } = createEm({ tenant: false })
    const { service: pricingService } = createPricingService()
    const error = await captureError(
      listBookableServicesForOrganization(em, { tenantId: TENANT, organizationId: ORG }, { pricingService }),
    )
    expect(error.status).toBe(404)
    expect(error.body).toMatchObject({ code: 'TENANT_NOT_FOUND' })
    expect(queries.some((query) => query.entity === CatalogProduct)).toBe(false)
  })

  it('rejects an organization that does not belong to the tenant', async () => {
    const { em } = createEm({ products: [service('p1', 'Signature Haircut')] })
    const { service: pricingService } = createPricingService()
    const error = await captureError(
      listBookableServicesForOrganization(em, { tenantId: TENANT, organizationId: OTHER_ORG }, { pricingService }),
    )
    expect(error.status).toBe(404)
    expect(error.body).toMatchObject({ code: 'ORGANIZATION_NOT_FOUND' })
  })

  it('scopes the product query to the requested tenant, organization and fieldset', async () => {
    const { em, queries } = createEm({ products: [service('p1', 'Signature Haircut')] })
    const { service: pricingService } = createPricingService()
    await listBookableServicesForOrganization(em, { tenantId: TENANT, organizationId: ORG }, { pricingService })
    const productQuery = queries.find((query) => query.entity === CatalogProduct)
    expect(productQuery?.where).toMatchObject({
      tenantId: TENANT,
      organizationId: { $in: [ORG] },
      isActive: true,
      deletedAt: null,
      $or: [{ customFieldsetCode: BOOKABLE_SERVICE_FIELDSET }, { productType: 'service' }],
    })
  })

  it('allows a child organization booking to use services stored on an ancestor organization', async () => {
    const { em } = createEm({
      products: [service('p1', 'Parent Catalog Service')],
      prices: [price('price-1', 'p1')],
      durations: { p1: 45 },
    })
    const { service: pricingService } = createPricingService()

    const items = await listBookableServicesForOrganization(
      em,
      { tenantId: TENANT, organizationId: CHILD_ORG },
      { pricingService },
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'p1',
      title: 'Parent Catalog Service',
      organizationId: ORG,
      durationMinutes: 45,
    })
  })

  it('returns duration and the price the pricing service resolved', async () => {
    const { em } = createEm({
      channelIds: ['channel-1'],
      products: [service('p1', 'Signature Haircut', { handle: 'signature-haircut' })],
      prices: [price('price-1', 'p1')],
      durations: { p1: 60 },
    })
    const { service: pricingService, resolvePriceMany } = createPricingService()
    const items = await listBookableServicesForOrganization(
      em,
      { tenantId: TENANT, organizationId: ORG },
      { pricingService },
    )
    expect(items).toEqual([
      {
        id: 'p1',
        title: 'Signature Haircut',
        subtitle: null,
        description: null,
        handle: 'signature-haircut',
        sku: null,
        categoryPath: [],
        categoryId: null,
        categoryName: null,
        currencyCode: 'USD',
        unitPriceNet: '95.0000',
        unitPriceGross: '95.0000',
        durationMinutes: 60,
        organizationId: ORG,
        tenantId: TENANT,
        optionGroups: [],
      },
    ])
    expect(resolvePriceMany).toHaveBeenCalledWith([
      { rows: expect.arrayContaining([expect.objectContaining({ id: 'price-1' })]), context: expect.objectContaining({ channelId: 'channel-1', quantity: 1 }) },
    ])
  })

  it('reports no amount when no stored price applies to an anonymous caller', async () => {
    // The only row is a negotiated customer-scoped rate, so the pricing pipeline
    // rejects it. It must not leak into the public menu as the service price.
    const { em } = createEm({
      products: [service('p1', 'Signature Haircut', { primaryCurrencyCode: 'USD' })],
      prices: [price('price-1', 'p1', { customerId: 'vip-customer', unitPriceNet: '10.0000' })],
    })
    const { service: pricingService } = createPricingService(() => null)
    const items = await listBookableServicesForOrganization(
      em,
      { tenantId: TENANT, organizationId: ORG },
      { pricingService },
    )
    expect(items[0]).toMatchObject({
      currencyCode: 'USD',
      unitPriceNet: null,
      unitPriceGross: null,
    })
  })

  it('never prices a quote-only service', async () => {
    const { em } = createEm({
      products: [service('p1', 'Bespoke Treatment', { isQuoteOnly: true })],
      prices: [price('price-1', 'p1')],
    })
    const { service: pricingService, resolvePriceMany } = createPricingService()
    const items = await listBookableServicesForOrganization(
      em,
      { tenantId: TENANT, organizationId: ORG },
      { pricingService },
    )
    expect(items[0]).toMatchObject({ unitPriceNet: null, unitPriceGross: null })
    expect(resolvePriceMany).toHaveBeenCalledWith([])
  })

  it('prices against the only active channel the organization has', async () => {
    const { em } = createEm({ channelIds: ['channel-1'], products: [service('p1', 'Signature Haircut')] })
    const { service: pricingService, resolvePriceMany } = createPricingService()
    await listBookableServicesForOrganization(em, { tenantId: TENANT, organizationId: ORG }, { pricingService })
    expect(resolvePriceMany).toHaveBeenCalledWith([
      { rows: [], context: expect.objectContaining({ channelId: 'channel-1' }) },
    ])
  })

  it('picks no channel when the organization sells through several', async () => {
    // An arbitrary pick would silently price the menu against one of them; only
    // unscoped prices apply until the caller names the channel it wants.
    const { em } = createEm({
      channelIds: ['channel-1', 'channel-2'],
      products: [service('p1', 'Signature Haircut')],
    })
    const { service: pricingService, resolvePriceMany } = createPricingService()
    await listBookableServicesForOrganization(em, { tenantId: TENANT, organizationId: ORG }, { pricingService })
    expect(resolvePriceMany).toHaveBeenCalledWith([
      { rows: [], context: expect.objectContaining({ channelId: null }) },
    ])
  })

  it('honours an explicitly requested channel', async () => {
    const { em } = createEm({
      channelIds: ['channel-1', 'channel-2'],
      products: [service('p1', 'Signature Haircut')],
    })
    const { service: pricingService, resolvePriceMany } = createPricingService()
    await listBookableServicesForOrganization(
      em,
      { tenantId: TENANT, organizationId: ORG, channelId: 'channel-2' },
      { pricingService },
    )
    expect(resolvePriceMany).toHaveBeenCalledWith([
      { rows: [], context: expect.objectContaining({ channelId: 'channel-2' }) },
    ])
  })

  it('rejects a channel that does not belong to the organization', async () => {
    const { em } = createEm({ channelIds: ['channel-1'], products: [service('p1', 'Signature Haircut')] })
    const { service: pricingService } = createPricingService()
    const error = await captureError(
      listBookableServicesForOrganization(
        em,
        { tenantId: TENANT, organizationId: ORG, channelId: 'someone-elses-channel' },
        { pricingService },
      ),
    )
    expect(error.status).toBe(404)
    expect(error.body).toMatchObject({ code: 'CHANNEL_NOT_FOUND' })
  })

  it('leaves duration null when the service carries no duration custom field', async () => {
    const { em } = createEm({ products: [service('p1', 'Signature Haircut')] })
    const { service: pricingService } = createPricingService()
    const items = await listBookableServicesForOrganization(
      em,
      { tenantId: TENANT, organizationId: ORG },
      { pricingService },
    )
    expect(items[0].durationMinutes).toBeNull()
  })
})
