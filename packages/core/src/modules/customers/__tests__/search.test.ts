jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>, params?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
      const values = typeof fallbackOrParams === 'object' && fallbackOrParams ? fallbackOrParams : params
      let out = fallback
      if (values) for (const [name, value] of Object.entries(values)) out = out.replace(new RegExp(`{{${name}}}`, 'g'), String(value))
      return out
    },
  }),
}))

import {
  getCustomerSearchEntityCacheSize,
  resetCustomerSearchEntityCache,
  searchConfig,
} from '../search'

describe('customers search config', () => {
  test('person profile buildSource loads customer entity by entity id without profile joins', async () => {
    const personConfig = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_person_profile')
    expect(personConfig?.buildSource).toBeDefined()

    const query = jest.fn(async () => ({
      items: [
        {
          id: 'entity-1',
          kind: 'person',
          display_name: 'Ada Lovelace',
          primary_email: 'ada@example.com',
        },
      ],
    }))

    const result = await personConfig!.buildSource!({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      queryEngine: {
        query,
      } as any,
      record: {
        id: 'profile-1',
        entity_id: 'entity-1',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      customFields: {},
    })

    expect(result).not.toBeNull()
    expect(query).toHaveBeenCalledWith(
      'customers:customer_entity',
      expect.objectContaining({
        filters: {
          id: { $eq: 'entity-1' },
        },
      }),
    )
    expect(query.mock.calls[0]?.[1]).not.toHaveProperty('customFieldSources')
  })

  test('person search results link to the v2 detail page (#2843)', async () => {
    const personConfig = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_person_profile')
    const ctx = { record: { entity_id: 'entity-1' } } as any

    const url = await personConfig!.resolveUrl!(ctx)
    expect(url).toBe('/backend/customers/people-v2/entity-1')

    const links = await personConfig!.resolveLinks!(ctx)
    expect(links?.[0]?.href).toContain('/backend/customers/people-v2/entity-1')
  })

  test('company search results link to the v2 detail page (#2843)', async () => {
    const companyConfig = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_company_profile')
    const ctx = { record: { entity_id: 'entity-2' } } as any

    const url = await companyConfig!.resolveUrl!(ctx)
    expect(url).toBe('/backend/customers/companies-v2/entity-2')

    const links = await companyConfig!.resolveLinks!(ctx)
    expect(links?.[0]?.href).toContain('/backend/customers/companies-v2/entity-2')
  })
})

describe('customer entity memo (#memory bound)', () => {
  const commentConfig = () =>
    searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_comment')!

  function makeQueryEngine() {
    return jest.fn(async (_entityId: string, options: any) => {
      const id = options?.filters?.id?.$eq ?? options?.filters?.id
      return { items: [{ id, kind: 'person', display_name: `Customer ${id}` }] }
    })
  }

  function formatComment(query: jest.Mock, entityId: string, organizationId = 'org-1') {
    return commentConfig().formatResult!({
      tenantId: 'tenant-1',
      organizationId,
      queryEngine: { query } as any,
      // A fresh record object each call: the sibling WeakMap caches cannot answer,
      // so every lookup goes through the entity-id memo under test.
      record: { id: `comment-${entityId}`, entity_id: entityId, body: 'note' },
      customFields: {},
    })
  }

  beforeEach(() => {
    resetCustomerSearchEntityCache()
  })

  test('caches by entity id, so repeat lookups do not re-query', async () => {
    const query = makeQueryEngine()
    await formatComment(query, 'entity-1')
    await formatComment(query, 'entity-1')

    expect(query).toHaveBeenCalledTimes(1)
    expect(getCustomerSearchEntityCacheSize()).toBe(1)
  })

  test('stays bounded and evicts least-recently-used entries instead of growing forever', async () => {
    const query = makeQueryEngine()
    const total = 1200
    for (let index = 0; index < total; index += 1) {
      await formatComment(query, `entity-${index}`)
    }

    const size = getCustomerSearchEntityCacheSize()
    expect(size).toBeLessThanOrEqual(1000)
    expect(size).toBeGreaterThan(0)
    expect(query).toHaveBeenCalledTimes(total)

    // The most recent entity is still cached; the oldest was evicted and re-queries.
    await formatComment(query, `entity-${total - 1}`)
    expect(query).toHaveBeenCalledTimes(total)

    await formatComment(query, 'entity-0')
    expect(query).toHaveBeenCalledTimes(total + 1)
    expect(getCustomerSearchEntityCacheSize()).toBeLessThanOrEqual(1000)
  })

  test('does not reuse one scope’s entity for another organization', async () => {
    const query = makeQueryEngine()
    await formatComment(query, 'entity-1', 'org-1')
    await formatComment(query, 'entity-1', 'org-2')

    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0]?.[1]).toMatchObject({ organizationId: 'org-1' })
    expect(query.mock.calls[1]?.[1]).toMatchObject({ organizationId: 'org-2' })
  })
})
