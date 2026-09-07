import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  parseWithCustomFields,
  setCustomFieldsIfAny,
} from '@open-mercato/shared/lib/commands/helpers'
import {
  buildCustomFieldResetMap,
  diffCustomFieldChanges,
  loadCustomFieldSnapshot,
  type CustomFieldSnapshot,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { ResourcesResourceArea, ResourcesResourceAreaType } from '../data/entities'
import {
  resourcesResourceAreaTypeCreateSchema,
  resourcesResourceAreaTypeUpdateSchema,
  type ResourcesResourceAreaTypeCreateInput,
  type ResourcesResourceAreaTypeUpdateInput,
} from '../data/validators'
import { resourcesResourceAreaTypeCrudEvents } from '../lib/crud'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { E } from '#generated/entities.ids.generated'

const areaTypeCrudIndexer: CrudIndexerConfig<ResourcesResourceAreaType> = {
  entityType: E.resources.resources_resource_area_type,
}

type AreaTypeSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  isActive: boolean
  deletedAt: string | null
}

type AreaTypeUndoPayload = {
  before?: AreaTypeSnapshot | null
  after?: AreaTypeSnapshot | null
  customBefore?: CustomFieldSnapshot | null
  customAfter?: CustomFieldSnapshot | null
}

async function loadAreaTypeSnapshot(
  em: EntityManager,
  id: string,
): Promise<AreaTypeSnapshot | null> {
  const areaType = await findOneWithDecryption(
    em,
    ResourcesResourceAreaType,
    { id },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!areaType) return null
  return {
    id: areaType.id,
    tenantId: areaType.tenantId,
    organizationId: areaType.organizationId,
    name: areaType.name,
    description: areaType.description ?? null,
    appearanceIcon: areaType.appearanceIcon ?? null,
    appearanceColor: areaType.appearanceColor ?? null,
    isActive: areaType.isActive,
    deletedAt: areaType.deletedAt ? areaType.deletedAt.toISOString() : null,
  }
}

async function loadAreaTypeCustomSnapshot(
  em: EntityManager,
  snapshot: AreaTypeSnapshot,
): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: E.resources.resources_resource_area_type,
    recordId: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

const createAreaTypeCommand: CommandHandler<
  ResourcesResourceAreaTypeCreateInput,
  { areaTypeId: string }
> = {
  id: 'resources.areaTypes.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(resourcesResourceAreaTypeCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(ResourcesResourceAreaType, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.resources.resources_resource_area_type,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaTypeCrudEvents,
      indexer: areaTypeCrudIndexer,
    })
    return { areaTypeId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadAreaTypeSnapshot(em, result.areaTypeId)
    if (!snapshot) return null
    const custom = await loadAreaTypeCustomSnapshot(em, snapshot)
    return { snapshot, custom }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadAreaTypeSnapshot(em, result.areaTypeId)
    if (!snapshot) return null
    const custom = await loadAreaTypeCustomSnapshot(em, snapshot)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.areaTypes.create', 'Create area type'),
      resourceKind: 'resources.resourceAreaType',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
          customAfter: custom,
        } satisfies AreaTypeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AreaTypeUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const areaType = await em.findOne(ResourcesResourceAreaType, { id: after.id })
    if (areaType) {
      areaType.deletedAt = new Date()
      areaType.updatedAt = new Date()
      await em.flush()

      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: areaType,
        identifiers: {
          id: areaType.id,
          organizationId: areaType.organizationId,
          tenantId: areaType.tenantId,
        },
        events: resourcesResourceAreaTypeCrudEvents,
        indexer: areaTypeCrudIndexer,
      })
    }
  },
  redo: makeCreateRedo<ResourcesResourceAreaType, AreaTypeSnapshot, ResourcesResourceAreaTypeCreateInput, { areaTypeId: string }>({
    entityClass: ResourcesResourceAreaType,
    buildResult: (entity) => ({ areaTypeId: entity.id }),
    events: resourcesResourceAreaTypeCrudEvents,
    indexer: areaTypeCrudIndexer,
    afterRestore: async ({ ctx, entity, logEntry }) => {
      const payload = extractUndoPayload<AreaTypeUndoPayload>(logEntry)
      if (!payload?.customAfter) return
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const reset = buildCustomFieldResetMap(payload.customAfter, undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.resources.resources_resource_area_type,
        recordId: entity.id,
        tenantId: entity.tenantId,
        organizationId: entity.organizationId,
        values: reset,
      })
    },
  }),
}

const updateAreaTypeCommand: CommandHandler<
  ResourcesResourceAreaTypeUpdateInput,
  { areaTypeId: string }
> = {
  id: 'resources.areaTypes.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(resourcesResourceAreaTypeUpdateSchema, rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadAreaTypeSnapshot(em, parsed.id)
    if (!snapshot) return {}
    const custom = await loadAreaTypeCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(resourcesResourceAreaTypeUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      ResourcesResourceAreaType,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Resource area type not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.appearanceIcon !== undefined) record.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) record.appearanceColor = parsed.appearanceColor ?? null
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    record.updatedAt = new Date()

    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.resources.resources_resource_area_type,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaTypeCrudEvents,
      indexer: areaTypeCrudIndexer,
    })
    return { areaTypeId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as AreaTypeSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadAreaTypeSnapshot(em, before.id)
    if (!after) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const customAfter = await loadAreaTypeCustomSnapshot(em, after)
    const changes = buildChanges(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      ['name', 'description', 'appearanceIcon', 'appearanceColor', 'isActive', 'deletedAt'],
    )
    const customChanges = diffCustomFieldChanges(customBefore, customAfter)
    if (Object.keys(customChanges).length) {
      changes.customFields = { from: customBefore ?? null, to: customAfter ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.areaTypes.update', 'Update area type'),
      resourceKind: 'resources.resourceAreaType',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
          customBefore: customBefore ?? null,
          customAfter,
        } satisfies AreaTypeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AreaTypeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const areaType = await em.findOne(ResourcesResourceAreaType, { id: before.id })
    if (!areaType) return
    areaType.name = before.name
    areaType.description = before.description ?? null
    areaType.appearanceIcon = before.appearanceIcon ?? null
    areaType.appearanceColor = before.appearanceColor ?? null
    areaType.isActive = before.isActive
    areaType.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    areaType.updatedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (payload.customBefore || payload.customAfter) {
      const currentCustom = await loadCustomFieldSnapshot(em, {
        entityId: E.resources.resources_resource_area_type,
        recordId: areaType.id,
        tenantId: areaType.tenantId,
        organizationId: areaType.organizationId,
      })
      const reset = buildCustomFieldResetMap(
        payload.customBefore ?? undefined,
        currentCustom ?? undefined,
      )
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.resources.resources_resource_area_type,
        recordId: areaType.id,
        tenantId: areaType.tenantId,
        organizationId: areaType.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: areaType,
      identifiers: {
        id: areaType.id,
        organizationId: areaType.organizationId,
        tenantId: areaType.tenantId,
      },
      events: resourcesResourceAreaTypeCrudEvents,
      indexer: areaTypeCrudIndexer,
    })
  },
}

const deleteAreaTypeCommand: CommandHandler<{ id?: string }, { areaTypeId: string }> = {
  id: 'resources.areaTypes.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Area type id is required.' })
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadAreaTypeSnapshot(em, id)
    if (!snapshot) return {}
    const custom = await loadAreaTypeCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Area type id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      ResourcesResourceAreaType,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Resource area type not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const assignedCount = await em.count(ResourcesResourceArea, {
      areaType: record.id,
      deletedAt: null,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
    })
    if (assignedCount > 0) {
      throw new CrudHttpError(400, { error: 'Area type has assigned areas.' })
    }
    record.deletedAt = new Date()
    record.updatedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceAreaTypeCrudEvents,
      indexer: areaTypeCrudIndexer,
    })
    return { areaTypeId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as AreaTypeSnapshot | undefined
    if (!before) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.areaTypes.delete', 'Delete area type'),
      resourceKind: 'resources.resourceAreaType',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          customBefore: customBefore ?? null,
        } satisfies AreaTypeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AreaTypeUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let areaType = await em.findOne(ResourcesResourceAreaType, { id: before.id })
    if (!areaType) {
      areaType = em.create(ResourcesResourceAreaType, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        name: before.name,
        description: before.description ?? null,
        appearanceIcon: before.appearanceIcon ?? null,
        appearanceColor: before.appearanceColor ?? null,
        isActive: before.isActive,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(areaType)
    } else {
      areaType.name = before.name
      areaType.description = before.description ?? null
      areaType.appearanceIcon = before.appearanceIcon ?? null
      areaType.appearanceColor = before.appearanceColor ?? null
      areaType.isActive = before.isActive
      areaType.deletedAt = null
      areaType.updatedAt = new Date()
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (payload.customBefore) {
      const reset = buildCustomFieldResetMap(payload.customBefore, undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.resources.resources_resource_area_type,
        recordId: areaType.id,
        tenantId: areaType.tenantId,
        organizationId: areaType.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: areaType,
      identifiers: {
        id: areaType.id,
        organizationId: areaType.organizationId,
        tenantId: areaType.tenantId,
      },
      events: resourcesResourceAreaTypeCrudEvents,
      indexer: areaTypeCrudIndexer,
    })
  },
}

registerCommand(createAreaTypeCommand)
registerCommand(updateAreaTypeCommand)
registerCommand(deleteAreaTypeCommand)
