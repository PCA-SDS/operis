import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { ResourcesResourceArea } from '../data/entities'
import {
  resourcesResourceAreaCreateSchema,
  resourcesResourceAreaReorderSchema,
  resourcesResourceAreaUpdateSchema,
  type ResourcesResourceAreaCreateInput,
  type ResourcesResourceAreaReorderInput,
  type ResourcesResourceAreaUpdateInput,
} from '../data/validators'
import { resourcesResourceAreaCrudEvents } from '../lib/crud'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { E } from '#generated/entities.ids.generated'

const resourceAreaCrudIndexer: CrudIndexerConfig<ResourcesResourceArea> = {
  entityType: E.resources.resources_resource_area,
}

type ResourceAreaSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  areaType: string
  parentAreaId: string | null
  sortOrder: number
  appearanceIcon: string | null
  appearanceColor: string | null
  isActive: boolean
  deletedAt: string | null
}

type ResourceAreaUndoPayload = {
  before?: ResourceAreaSnapshot | null
  after?: ResourceAreaSnapshot | null
}

type ResourceAreaReorderSnapshot = {
  areas: Array<{ id: string; sortOrder: number }>
}

type ResourceAreaReorderUndoPayload = {
  before?: ResourceAreaReorderSnapshot | null
  after?: ResourceAreaReorderSnapshot | null
}

async function loadResourceAreaSnapshot(em: EntityManager, id: string): Promise<ResourceAreaSnapshot | null> {
  const area = await em.findOne(ResourcesResourceArea, { id })
  if (!area) return null
  return {
    id: area.id,
    tenantId: area.tenantId,
    organizationId: area.organizationId,
    name: area.name,
    description: area.description ?? null,
    areaType: area.areaType,
    parentAreaId: area.parentAreaId ?? null,
    sortOrder: area.sortOrder,
    appearanceIcon: area.appearanceIcon ?? null,
    appearanceColor: area.appearanceColor ?? null,
    isActive: area.isActive,
    deletedAt: area.deletedAt ? area.deletedAt.toISOString() : null,
  }
}

async function checkCircularDependency(em: EntityManager, areaId: string, newParentId: string): Promise<void> {
  if (areaId === newParentId) throw new CrudHttpError(400, { error: 'Area cannot be its own parent.' })
  let currentParentId: string | null | undefined = newParentId
  while (currentParentId) {
    const parent: ResourcesResourceArea | null = await em.findOne(ResourcesResourceArea, { id: currentParentId })
    if (!parent) break
    if (parent.id === areaId) {
      throw new CrudHttpError(400, { error: 'Circular dependency detected in area parent hierarchy.' })
    }
    currentParentId = parent.parentAreaId
  }
}

async function resolveNextAreaSortOrder(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; parentAreaId?: string | null },
): Promise<number> {
  const siblings = await em.find(
    ResourcesResourceArea,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      parentAreaId: params.parentAreaId ?? null,
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'DESC', name: 'ASC' }, limit: 1 },
  )
  return (siblings[0]?.sortOrder ?? -1) + 1
}

function snapshotAreaOrder(areas: ResourcesResourceArea[]): ResourceAreaReorderSnapshot {
  return {
    areas: areas.map((area) => ({ id: area.id, sortOrder: area.sortOrder ?? 0 })),
  }
}

function moveSiblingOrder<TEntity extends { id: string }>(
  rows: TEntity[],
  input: {
    id: string
    targetId?: string
    direction?: 'up' | 'down'
    position?: 'top' | 'bottom' | 'before' | 'after'
  },
): TEntity[] {
  const ordered = [...rows]
  const from = ordered.findIndex((row) => row.id === input.id)
  if (from < 0) throw new CrudHttpError(404, { error: 'Reorder item not found.' })
  if (input.position === 'top' || input.position === 'bottom') {
    const [moving] = ordered.splice(from, 1)
    ordered.splice(input.position === 'top' ? 0 : ordered.length, 0, moving)
    return ordered
  }
  if (input.targetId) {
    if (input.targetId === input.id) return ordered
    const [moving] = ordered.splice(from, 1)
    const target = ordered.findIndex((row) => row.id === input.targetId)
    if (target < 0) throw new CrudHttpError(404, { error: 'Reorder target not found.' })
    ordered.splice(input.position === 'after' ? target + 1 : target, 0, moving)
    return ordered
  }
  const to = input.direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= ordered.length) return ordered
  const [moving] = ordered.splice(from, 1)
  ordered.splice(to, 0, moving)
  return ordered
}

const createResourceAreaCommand: CommandHandler<ResourcesResourceAreaCreateInput, { areaId: string }> = {
  id: 'resources.resourceAreas.create',
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceAreaCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (parsed.parentAreaId) {
      const parent = await em.findOne(ResourcesResourceArea, { id: parsed.parentAreaId })
      if (!parent) throw new CrudHttpError(404, { error: 'Parent area not found.' })
    }

    const hasExplicitSortOrder = Boolean(rawInput && typeof rawInput === 'object' && 'sortOrder' in rawInput)
    const sortOrder = hasExplicitSortOrder
      ? parsed.sortOrder ?? 0
      : await resolveNextAreaSortOrder(em, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          parentAreaId: parsed.parentAreaId ?? null,
        })

    const record = em.create(ResourcesResourceArea, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      areaType: parsed.areaType ?? 'other',
      parentAreaId: parsed.parentAreaId ?? null,
      sortOrder,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      isActive: parsed.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await withAtomicFlush(em, [
      async () => {
        em.persist(record)
        await em.flush()
      },
    ], { transaction: true })

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaCrudEvents,
      indexer: resourceAreaCrudIndexer,
    })
    return { areaId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadResourceAreaSnapshot(em, result.areaId)
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadResourceAreaSnapshot(em, result?.areaId ?? '')
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resourceAreas.create', 'Create resource area'),
      resourceKind: 'resources.resourceArea',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies ResourceAreaUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceAreaUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, { id: after.id })
    if (record) {
      record.deletedAt = new Date()
      record.updatedAt = new Date()
      await em.flush()

      const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
        events: resourcesResourceAreaCrudEvents,
        indexer: resourceAreaCrudIndexer,
      })
    }
  },
  redo: async ({ logEntry, ctx }) => {
    const after = resolveRedoSnapshot<ResourceAreaSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for resource area create' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(ResourcesResourceArea, { id: after.id })
    await withAtomicFlush(em, [
      async () => {
        if (!record) {
          record = em.create(ResourcesResourceArea, {
            id: after.id,
            tenantId: after.tenantId,
            organizationId: after.organizationId,
            name: after.name,
            description: after.description ?? null,
            areaType: after.areaType ?? 'other',
            parentAreaId: after.parentAreaId ?? null,
            sortOrder: after.sortOrder ?? 0,
            appearanceIcon: after.appearanceIcon ?? null,
            appearanceColor: after.appearanceColor ?? null,
            isActive: after.isActive,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          em.persist(record)
        } else {
          record.name = after.name
          record.description = after.description ?? null
          record.areaType = after.areaType ?? 'other'
          record.parentAreaId = after.parentAreaId ?? null
          record.sortOrder = after.sortOrder ?? 0
          record.appearanceIcon = after.appearanceIcon ?? null
          record.appearanceColor = after.appearanceColor ?? null
          record.isActive = after.isActive
          record.deletedAt = null
          record.updatedAt = new Date()
        }
        await em.flush()
      },
    ], { transaction: true })

    const resolvedRecord = record as ResourcesResourceArea
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: resolvedRecord,
      identifiers: {
        id: resolvedRecord.id,
        organizationId: resolvedRecord.organizationId,
        tenantId: resolvedRecord.tenantId,
      },
      events: resourcesResourceAreaCrudEvents,
      indexer: resourceAreaCrudIndexer,
    })
    return { areaId: resolvedRecord.id }
  },
}

const updateResourceAreaCommand: CommandHandler<ResourcesResourceAreaUpdateInput, { areaId: string }> = {
  id: 'resources.resourceAreas.update',
  async prepare(rawInput, ctx) {
    const parsed = resourcesResourceAreaUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceAreaSnapshot(em, parsed.id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceAreaUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Resource area not found.' })
    
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const parentChanged = parsed.parentAreaId !== undefined && parsed.parentAreaId !== record.parentAreaId
    if (parentChanged) {
      if (parsed.parentAreaId) {
        await checkCircularDependency(em, record.id, parsed.parentAreaId)
        const parent = await em.findOne(ResourcesResourceArea, { id: parsed.parentAreaId, deletedAt: null })
        if (!parent) throw new CrudHttpError(404, { error: 'Parent area not found.' })
      }
      record.parentAreaId = parsed.parentAreaId
      if (parsed.sortOrder === undefined) {
        record.sortOrder = await resolveNextAreaSortOrder(em, {
          tenantId: record.tenantId,
          organizationId: record.organizationId,
          parentAreaId: parsed.parentAreaId ?? null,
        })
      }
    }

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description
    if (parsed.areaType !== undefined) record.areaType = parsed.areaType
    if (parsed.sortOrder !== undefined) record.sortOrder = parsed.sortOrder
    if (parsed.appearanceIcon !== undefined) record.appearanceIcon = parsed.appearanceIcon
    if (parsed.appearanceColor !== undefined) record.appearanceColor = parsed.appearanceColor
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive

    record.updatedAt = new Date()

    await withAtomicFlush(em, [
      async () => {
        await em.flush()
      },
    ], { transaction: true })

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaCrudEvents,
      indexer: resourceAreaCrudIndexer,
    })
    return { areaId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadResourceAreaSnapshot(em, result.areaId)
    if (!snapshot) return null
    return { snapshot }
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadResourceAreaSnapshot(em, result?.areaId ?? '')
    if (!snapshot) return null
    const before = snapshots?.before as ResourceAreaSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resourceAreas.update', 'Update resource area'),
      resourceKind: 'resources.resourceArea',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotBefore: before,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          before,
          after: snapshot,
        } satisfies ResourceAreaUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceAreaUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, { id: before.id })
    if (!record) return
    
    record.name = before.name
    record.description = before.description
    record.areaType = before.areaType
    record.parentAreaId = before.parentAreaId
    record.sortOrder = before.sortOrder
    record.appearanceIcon = before.appearanceIcon
    record.appearanceColor = before.appearanceColor
    record.isActive = before.isActive
    record.updatedAt = new Date()

    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaCrudEvents,
      indexer: resourceAreaCrudIndexer,
    })
  },
  redo: async ({ logEntry, ctx }) => {
    const after = resolveRedoSnapshot<ResourceAreaSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for resource area update' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, { id: after.id })
    if (!record) throw new CrudHttpError(404, { error: 'Resource area not found for redo.' })
    
    record.name = after.name
    record.description = after.description
    record.areaType = after.areaType
    record.parentAreaId = after.parentAreaId
    record.sortOrder = after.sortOrder
    record.appearanceIcon = after.appearanceIcon
    record.appearanceColor = after.appearanceColor
    record.isActive = after.isActive
    record.updatedAt = new Date()

    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaCrudEvents,
      indexer: resourceAreaCrudIndexer,
    })
    return { areaId: record.id }
  },
}

const deleteResourceAreaCommand: CommandHandler<{ id?: string }, { areaId: string }> = {
  id: 'resources.resourceAreas.delete',
  async prepare(rawInput, ctx) {
    const id = typeof rawInput?.id === 'string' ? rawInput.id : null
    if (!id) return {}
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceAreaSnapshot(em, id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = typeof input?.id === 'string' ? input.id : null
    if (!id) throw new CrudHttpError(400, { error: 'Area id is required' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Resource area not found' })
    
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    // Check if there are children areas before deleting
    const children = await em.count(ResourcesResourceArea, { parentAreaId: record.id, deletedAt: null })
    if (children > 0) {
      throw new CrudHttpError(400, { error: 'Cannot delete area with child areas.' })
    }

    await withAtomicFlush(em, [
      async () => {
        record.deletedAt = new Date()
        record.updatedAt = new Date()
        await em.flush()
      },
    ], { transaction: true })

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaCrudEvents,
      indexer: resourceAreaCrudIndexer,
    })
    return { areaId: id }
  },
  buildLog: async ({ input, snapshots, ctx }) => {
    const before = snapshots?.before as ResourceAreaSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resourceAreas.delete', 'Delete resource area'),
      resourceKind: 'resources.resourceArea',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies ResourceAreaUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceAreaUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(ResourcesResourceArea, { id: before.id })
    await withAtomicFlush(em, [
      async () => {
        if (!record) {
          record = em.create(ResourcesResourceArea, {
            id: before.id,
            tenantId: before.tenantId,
            organizationId: before.organizationId,
            name: before.name,
            description: before.description ?? null,
            areaType: before.areaType ?? 'other',
            parentAreaId: before.parentAreaId ?? null,
            sortOrder: before.sortOrder ?? 0,
            appearanceIcon: before.appearanceIcon ?? null,
            appearanceColor: before.appearanceColor ?? null,
            isActive: before.isActive,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          em.persist(record)
        } else {
          record.deletedAt = null
          record.updatedAt = new Date()
        }
        await em.flush()
      },
    ], { transaction: true })

    const resolvedRecord = record as ResourcesResourceArea
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: resolvedRecord,
      identifiers: {
        id: resolvedRecord.id,
        organizationId: resolvedRecord.organizationId,
        tenantId: resolvedRecord.tenantId,
      },
      events: resourcesResourceAreaCrudEvents,
      indexer: resourceAreaCrudIndexer,
    })
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceAreaUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) {
      throw new CrudHttpError(400, { error: '[internal] redo payload unavailable for resource area delete' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, { id: before.id })
    if (record) {
      record.deletedAt = new Date()
      record.updatedAt = new Date()
      await em.flush()
      
      const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
        events: resourcesResourceAreaCrudEvents,
        indexer: resourceAreaCrudIndexer,
      })
    }
    return { areaId: before.id }
  },
}

const reorderResourceAreasCommand: CommandHandler<ResourcesResourceAreaReorderInput, { updatedIds: string[] }> = {
  id: 'resources.resourceAreas.reorder',
  async prepare(rawInput, ctx) {
    const parsed = resourcesResourceAreaReorderSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager)
    const record = await em.findOne(ResourcesResourceArea, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) return {}
    const siblings = await em.find(
      ResourcesResourceArea,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        parentAreaId: record.parentAreaId ?? null,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'ASC', name: 'ASC', id: 'ASC' } },
    )
    return { before: snapshotAreaOrder(siblings) }
  },
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceAreaReorderSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) throw new CrudHttpError(404, { error: 'Resource area not found.' })
    if (parsed.targetId) {
      const target = await em.findOne(ResourcesResourceArea, {
        id: parsed.targetId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        parentAreaId: record.parentAreaId ?? null,
        deletedAt: null,
      })
      if (!target) throw new CrudHttpError(404, { error: 'Resource area reorder target not found.' })
    }

    const siblings = await em.find(
      ResourcesResourceArea,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        parentAreaId: record.parentAreaId ?? null,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'ASC', name: 'ASC', id: 'ASC' } },
    )
    const reordered = moveSiblingOrder(siblings, parsed)
    const now = new Date()
    reordered.forEach((area, index) => {
      area.sortOrder = index
      area.updatedAt = now
    })
    await em.flush()
    return { updatedIds: reordered.map((area) => area.id) }
  },
  captureAfter: async (input, _result, ctx) => {
    const parsed = resourcesResourceAreaReorderSchema.parse(input ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResourceArea, { id: parsed.id })
    if (!record) return null
    const siblings = await em.find(
      ResourcesResourceArea,
      {
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        parentAreaId: record.parentAreaId ?? null,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'ASC', name: 'ASC', id: 'ASC' } },
    )
    return { after: snapshotAreaOrder(siblings) }
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = resourcesResourceAreaReorderSchema.parse(input ?? {})
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resourceAreas.reorder', 'Reorder resource areas'),
      resourceKind: 'resources.resourceArea',
      resourceId: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      snapshotBefore: snapshots.before,
      snapshotAfter: snapshots.after,
      payload: {
        undo: {
          before: snapshots.before as ResourceAreaReorderSnapshot | null | undefined,
          after: snapshots.after as ResourceAreaReorderSnapshot | null | undefined,
        } satisfies ResourceAreaReorderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceAreaReorderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ids = before.areas.map((area) => area.id)
    const areas = await em.find(ResourcesResourceArea, { id: { $in: ids } })
    const byId = new Map(areas.map((area) => [area.id, area]))
    const now = new Date()
    before.areas.forEach((snapshot) => {
      const area = byId.get(snapshot.id)
      if (!area) return
      area.sortOrder = snapshot.sortOrder
      area.updatedAt = now
    })
    await em.flush()
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceAreaReorderUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return { updatedIds: [] }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ids = after.areas.map((area) => area.id)
    const areas = await em.find(ResourcesResourceArea, { id: { $in: ids } })
    const byId = new Map(areas.map((area) => [area.id, area]))
    const now = new Date()
    after.areas.forEach((snapshot) => {
      const area = byId.get(snapshot.id)
      if (!area) return
      area.sortOrder = snapshot.sortOrder
      area.updatedAt = now
    })
    await em.flush()
    return { updatedIds: ids }
  },
}

registerCommand(createResourceAreaCommand)
registerCommand(updateResourceAreaCommand)
registerCommand(deleteResourceAreaCommand)
registerCommand(reorderResourceAreasCommand)
