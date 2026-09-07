/** @jest-environment node */

/**
 * Scope and hierarchy-integrity guards on the resource-area commands.
 *
 * `parentAreaId` and `areaTypeId` arrive as bare uuids in the request body.
 * `createResourceCommand` already refuses a Resource whose Area belongs to
 * another organization; these cover the same invariant for an Area's own two
 * references, plus the cycle walk and the delete guards.
 */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { ResourcesResource, ResourcesResourceArea, ResourcesResourceAreaType } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
  }
})

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const OTHER_ORG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_TENANT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const AREA_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const PARENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const AREA_TYPE_ID = '11111111-1111-4111-8111-111111111111'

type Row = Record<string, unknown> & { id: string }

/**
 * Fake EM that dispatches `findOne`/`count` on the entity class, so a test can
 * stage an area, an area type and a resource independently instead of relying
 * on the order the command happens to query them in.
 */
function buildFakeEm(rows: {
  areas?: Row[]
  areaTypes?: Row[]
  resourceCount?: number
  childCount?: number
}) {
  const areas = rows.areas ?? []
  const areaTypes = rows.areaTypes ?? []
  const created: Row[] = []
  return {
    created,
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    // withAtomicFlush(..., { transaction: true }) drives these directly.
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    isInTransaction: jest.fn().mockReturnValue(false),
    find: jest.fn().mockResolvedValue([]),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    create: jest.fn((_entity: unknown, data: Row) => {
      const row = { id: AREA_ID, ...data }
      created.push(row)
      return row
    }),
    count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === ResourcesResource) return rows.resourceCount ?? 0
      if (entity === ResourcesResourceArea && 'parentAreaId' in where) return rows.childCount ?? 0
      return 0
    }),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const pool = entity === ResourcesResourceAreaType ? areaTypes : areas
      return pool.find((row) => row.id === where.id) ?? null
    }),
  }
}

function buildCtx(em: ReturnType<typeof buildFakeEm>) {
  return {
    container: {
      resolve: jest.fn((name: string) => (name === 'em' ? { fork: () => em } : {})),
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
}

const inScopeArea = (id: string, parentAreaId: string | null = null): Row => ({
  id,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  parentAreaId,
  name: `Area ${id.slice(0, 4)}`,
  sortOrder: 0,
  isActive: true,
  deletedAt: null,
  updatedAt: new Date('2026-09-05T10:00:00.000Z'),
})

const createInput = (extra: Record<string, unknown>) => ({
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  name: 'Zone A',
  ...extra,
})

describe('resource area scope guards', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../areas')
  })

  describe('create', () => {
    it('accepts a parent area and area type from the same organization', async () => {
      const em = buildFakeEm({
        areas: [inScopeArea(PARENT_ID)],
        areaTypes: [{ id: AREA_TYPE_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }],
      })
      const handler = commandRegistry.get('resources.resourceAreas.create')

      await expect(
        handler!.execute(createInput({ parentAreaId: PARENT_ID, areaTypeId: AREA_TYPE_ID }), buildCtx(em) as any),
      ).resolves.toEqual({ areaId: AREA_ID })
      expect(em.created[0]).toMatchObject({ areaType: { id: AREA_TYPE_ID } })
    })

    it('refuses a parent area owned by another organization', async () => {
      const em = buildFakeEm({
        areas: [{ ...inScopeArea(PARENT_ID), organizationId: OTHER_ORG_ID }],
      })
      const handler = commandRegistry.get('resources.resourceAreas.create')

      await expect(
        handler!.execute(createInput({ parentAreaId: PARENT_ID }), buildCtx(em) as any),
      ).rejects.toMatchObject({ status: 400 })
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('refuses an area type owned by another tenant', async () => {
      const em = buildFakeEm({
        areaTypes: [{ id: AREA_TYPE_ID, tenantId: OTHER_TENANT_ID, organizationId: ORG_ID, deletedAt: null }],
      })
      const handler = commandRegistry.get('resources.resourceAreas.create')

      await expect(
        handler!.execute(createInput({ areaTypeId: AREA_TYPE_ID }), buildCtx(em) as any),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('answers 404 for an unknown area type instead of failing on the foreign key', async () => {
      const em = buildFakeEm({})
      const handler = commandRegistry.get('resources.resourceAreas.create')

      await expect(
        handler!.execute(createInput({ areaTypeId: AREA_TYPE_ID }), buildCtx(em) as any),
      ).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('update', () => {
    it('refuses to re-point an area at another organization area type', async () => {
      const em = buildFakeEm({
        areas: [inScopeArea(AREA_ID)],
        areaTypes: [{ id: AREA_TYPE_ID, tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, deletedAt: null }],
      })
      const handler = commandRegistry.get('resources.resourceAreas.update')

      await expect(
        handler!.execute(
          { id: AREA_ID, tenantId: TENANT_ID, organizationId: ORG_ID, areaTypeId: AREA_TYPE_ID },
          buildCtx(em) as any,
        ),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('terminates on a stored cycle that does not contain the edited area', async () => {
      // A pair of concurrent re-parents can each pass the check and then commit
      // a loop; walking it without a visited set never returns.
      const first = inScopeArea(PARENT_ID, AREA_TYPE_ID)
      const second = inScopeArea(AREA_TYPE_ID, PARENT_ID)
      const em = buildFakeEm({ areas: [inScopeArea(AREA_ID), first, second] })
      const handler = commandRegistry.get('resources.resourceAreas.update')

      await expect(
        handler!.execute(
          { id: AREA_ID, tenantId: TENANT_ID, organizationId: ORG_ID, parentAreaId: PARENT_ID },
          buildCtx(em) as any,
        ),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('delete', () => {
    it('refuses while resources are still assigned to the area', async () => {
      const em = buildFakeEm({ areas: [inScopeArea(AREA_ID)], resourceCount: 3 })
      const handler = commandRegistry.get('resources.resourceAreas.delete')

      await expect(handler!.execute({ id: AREA_ID }, buildCtx(em) as any)).rejects.toMatchObject({ status: 400 })
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('soft-deletes an area with no children and no assigned resources', async () => {
      const area = inScopeArea(AREA_ID)
      const em = buildFakeEm({ areas: [area] })
      const handler = commandRegistry.get('resources.resourceAreas.delete')

      await expect(handler!.execute({ id: AREA_ID }, buildCtx(em) as any)).resolves.toEqual({ areaId: AREA_ID })
      expect(area.deletedAt).toBeInstanceOf(Date)
    })
  })
})
