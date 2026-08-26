import { CatalogProduct, CatalogProductOptionGroup, CatalogProductOption } from '../../data/entities'

const registerCommand = jest.fn()
jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const PRODUCT = '11111111-1111-4111-8111-111111111111'

function loadCommand(): { execute: (input: any, ctx: any) => Promise<any> } {
  let command: any
  jest.isolateModules(() => {
    require('../productOptionTree')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.product_options.sync_tree')?.[0]
  })
  if (!command) throw new Error(`command not registered`)
  return command
}

function buildMockEm() {
  const removes: any[] = []
  const persists: any[] = []
  let flushCount = 0

  const mockProduct = { id: PRODUCT, tenantId: TENANT, organizationId: ORG }

  const em = {
    findOne: jest.fn().mockResolvedValue(mockProduct),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((entityCls, payload) => {
      const record = { ...payload }
      // mock id if not provided
      if (!record.id) record.id = '99999999-9999-4999-8999-999999999999'
      return record
    }),
    remove: jest.fn().mockImplementation((entity) => {
      removes.push(entity)
    }),
    persist: jest.fn().mockImplementation((entity) => {
      persists.push(entity)
    }),
    flush: jest.fn().mockImplementation(async () => {
      flushCount++
    }),
    transactional: jest.fn().mockImplementation(async (cb) => {
      await cb(em)
    }),
    fork: jest.fn().mockReturnThis(),
  }
  return { em, removes, persists, getFlushCount: () => flushCount }
}

describe('catalog.product_options.sync_tree', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects foreign group IDs', async () => {
    const cmd = loadCommand()
    const { em } = buildMockEm()

    // simulate a foreign group existing in DB for another product
    em.find.mockImplementation(async (entityCls, where) => {
      console.log('em.find called with', entityCls.name, where)
      if (entityCls.name === 'CatalogProductOptionGroup' && (where as any).id) {
        return [{ id: '11111111-1111-1111-8111-111111111111', product: { id: 'OTHER' }, tenantId: TENANT, organizationId: ORG }]
      }
      return []
    })

    const ctx = {
      container: { resolve: () => em },
      auth: { tenantId: TENANT, orgId: ORG },
    }
    const input = {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      groups: [{ id: '11111111-1111-1111-8111-111111111111', name: 'Foreign Group', sortOrder: 1, isActive: true }],
      options: [],
    }

    await expect(cmd.execute(input, ctx)).rejects.toThrow('Foreign group ID detected')
  })

  it('syncs correctly, deleting removed items and upserting others', async () => {
    const cmd = loadCommand()
    const { em, removes, persists, getFlushCount } = buildMockEm()

    const existingGroup = { id: '22222222-1111-1111-8111-111111111111', product: PRODUCT, tenantId: TENANT, organizationId: ORG, name: 'Old' }
    const existingOption = { id: '33333333-1111-1111-8111-111111111111', group: existingGroup, tenantId: TENANT, organizationId: ORG, name: 'Old Opt' }
    const groupToRemove = { id: '44444444-1111-1111-8111-111111111111', product: PRODUCT, tenantId: TENANT, organizationId: ORG, name: 'Delete' }
    const optToRemove = { id: '55555555-1111-1111-8111-111111111111', group: groupToRemove, tenantId: TENANT, organizationId: ORG, name: 'Delete opt' }

    // Mock existing entities for the snapshot / diff logic
    em.find.mockImplementation(async (entityCls, where) => {
      console.log('em.find called with', entityCls.name, where)
      if (entityCls.name === 'CatalogProductOptionGroup' && !(where as any).id) {
        // returning existing groups
        return [existingGroup, groupToRemove]
      }
      if (entityCls.name === 'CatalogProductOption' && !(where as any).id) {
        // returning existing options
        return [existingOption, optToRemove]
      }
      return []
    })

    const ctx = {
      container: { resolve: () => em },
      auth: { tenantId: TENANT, orgId: ORG },
    }
    const input = {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      groups: [
        { id: '22222222-1111-1111-8111-111111111111', name: 'Updated Name', sortOrder: 1, isActive: true },
        { id: '66666666-1111-1111-8111-111111111111', name: 'New Name', sortOrder: 2, isActive: true },
      ],
      options: [
        { id: '33333333-1111-1111-8111-111111111111', groupId: '22222222-1111-1111-8111-111111111111', name: 'Updated Opt', sortOrder: 1, isActive: true },
        { id: '77777777-1111-1111-8111-111111111111', groupId: '66666666-1111-1111-8111-111111111111', name: 'New Opt', sortOrder: 1, isActive: true },
      ],
    }

    await cmd.execute(input, ctx)

    // Should remove the items not in the payload
    expect(removes).toHaveLength(2)
    expect(removes).toContainEqual(groupToRemove)
    expect(removes).toContainEqual(optToRemove)

    // Should persist the new items
    expect(persists).toHaveLength(2)
    expect(persists.some(p => p.id === '66666666-1111-1111-8111-111111111111')).toBe(true)
    expect(persists.some(p => p.id === '77777777-1111-1111-8111-111111111111')).toBe(true)

    // Should update existing items inline
    expect(existingGroup.name).toBe('Updated Name')
    expect(existingOption.name).toBe('Updated Opt')

    expect(getFlushCount()).toBeGreaterThanOrEqual(3) // Flushes for deletes, groups, options
  })
})
