import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { buildCustomFieldResetMap, diffCustomFieldChanges, loadCustomFieldSnapshot, type CustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { ResourcesResource, ResourcesResourceTag, ResourcesResourceTagAssignment, ResourcesResourceArea } from '../data/entities'
import {
  resourcesResourceCreateSchema,
  resourcesResourceReorderSchema,
  resourcesResourceUpdateSchema,
  type ResourcesResourceCreateInput,
  type ResourcesResourceReorderInput,
  type ResourcesResourceUpdateInput,
} from '../data/validators'
import { resourcesResourceCrudEvents } from '../lib/crud'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY } from '../lib/capacityUnits'
import { E } from '#generated/entities.ids.generated'

const resourceCrudIndexer: CrudIndexerConfig<ResourcesResource> = {
  entityType: E.resources.resources_resource,
}

type CapacityUnitSnapshot = {
  value: string
  name: string
  color: string | null
  icon: string | null
}

type ResourceSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  resourceTypeId: string | null
  areaId: string | null
  sortOrder: number
  capacity: number | null
  capacityUnitValue: string | null
  capacityUnitName: string | null
  capacityUnitColor: string | null
  capacityUnitIcon: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  isActive: boolean
  availabilityRuleSetId: string | null
  customFieldsetCode: string | null
  tags: string[]
  deletedAt: string | null
  customFields?: CustomFieldSnapshot | null
}

type ResourceUndoPayload = {
  before?: ResourceSnapshot | null
  after?: ResourceSnapshot | null
  customBefore?: CustomFieldSnapshot | null
  customAfter?: CustomFieldSnapshot | null
}

type ResourceReorderSnapshot = {
  resources: Array<{ id: string; sortOrder: number }>
}

type ResourceReorderUndoPayload = {
  before?: ResourceReorderSnapshot | null
  after?: ResourceReorderSnapshot | null
}

async function resolveCapacityUnit(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  rawValue: string,
): Promise<CapacityUnitSnapshot> {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    throw new CrudHttpError(400, { error: 'Capacity unit is required.' })
  }
  const dictionary = await findOneWithDecryption(
    em,
    Dictionary,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      key: RESOURCES_CAPACITY_UNIT_DICTIONARY_KEY,
      deletedAt: null,
      isActive: true,
    },
    undefined,
    scope,
  )
  if (!dictionary) {
    throw new CrudHttpError(400, { error: 'Capacity unit dictionary is not configured.' })
  }
  const normalizedValue = trimmed.toLowerCase()
  const entry = await findOneWithDecryption(
    em,
    DictionaryEntry,
    {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      normalizedValue,
    },
    { populate: ['dictionary'] },
    scope,
  )
  if (!entry) {
    throw new CrudHttpError(400, { error: 'Capacity unit not found.' })
  }
  return {
    value: entry.value,
    name: entry.label?.trim().length ? entry.label : entry.value,
    color: entry.color ?? null,
    icon: entry.icon ?? null,
  }
}

function normalizeTagIds(tags?: Array<string | null | undefined>): string[] {
  if (!Array.isArray(tags)) return []
  const set = new Set<string>()
  tags.forEach((id) => {
    if (typeof id === 'string' && id.trim().length > 0) set.add(id.trim())
  })
  return Array.from(set)
}

async function resolveNextResourceSortOrder(
  em: EntityManager,
  params: { tenantId: string; organizationId: string; areaId?: string | null },
): Promise<number> {
  const siblings = await em.find(
    ResourcesResource,
    {
      tenantId: params.tenantId,
      organizationId: params.organizationId,
      areaId: params.areaId ?? null,
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'DESC', name: 'ASC' }, limit: 1 },
  )
  return (siblings[0]?.sortOrder ?? -1) + 1
}

function snapshotResourceOrder(resources: ResourcesResource[]): ResourceReorderSnapshot {
  return {
    resources: resources.map((resource) => ({ id: resource.id, sortOrder: resource.sortOrder ?? 0 })),
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

async function loadResourceSnapshot(em: EntityManager, id: string): Promise<ResourceSnapshot | null> {
  const resource = await findOneWithDecryption(
    em,
    ResourcesResource,
    { id },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!resource) return null
  const assignments = await em.find(
    ResourcesResourceTagAssignment,
    { resource: resource.id },
    { populate: ['tag'] },
  )
  const tags = assignments
    .map((assignment) => (assignment.tag as ResourcesResourceTag | undefined)?.id ?? null)
    .filter((tagId): tagId is string => typeof tagId === 'string' && tagId.length > 0)
    .sort((a, b) => a.localeCompare(b))
  return {
    id: resource.id,
    tenantId: resource.tenantId,
    organizationId: resource.organizationId,
    name: resource.name,
    description: resource.description ?? null,
    resourceTypeId: resource.resourceTypeId ?? null,
    areaId: resource.areaId ?? null,
    sortOrder: resource.sortOrder ?? 0,
    capacity: resource.capacity ?? null,
    capacityUnitValue: resource.capacityUnitValue ?? null,
    capacityUnitName: resource.capacityUnitName ?? null,
    capacityUnitColor: resource.capacityUnitColor ?? null,
    capacityUnitIcon: resource.capacityUnitIcon ?? null,
    appearanceIcon: resource.appearanceIcon ?? null,
    appearanceColor: resource.appearanceColor ?? null,
    isActive: resource.isActive,
    availabilityRuleSetId: resource.availabilityRuleSetId ?? null,
    customFieldsetCode: resource.customFieldsetCode ?? null,
    tags,
    deletedAt: resource.deletedAt ? resource.deletedAt.toISOString() : null,
  }
}

async function loadResourceCustomSnapshot(em: EntityManager, snapshot: ResourceSnapshot): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: E.resources.resources_resource,
    recordId: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

async function syncResourcesResourceTags(em: EntityManager, params: {
  resourceId: string
  organizationId: string
  tenantId: string
  tagIds?: Array<string | null | undefined> | null
}) {
  if (params.tagIds === undefined) return
  const tagIds = normalizeTagIds(params.tagIds ?? [])
  if (tagIds.length === 0) {
    await em.nativeDelete(ResourcesResourceTagAssignment, { resource: params.resourceId })
    return
  }
  const tagsInScope = await em.find(ResourcesResourceTag, {
    id: { $in: tagIds },
    organizationId: params.organizationId,
    tenantId: params.tenantId,
  })
  if (tagsInScope.length !== tagIds.length) {
    throw new CrudHttpError(400, { error: 'One or more tags not found for this scope' })
  }
  const byId = new Map(tagsInScope.map((tag) => [tag.id, tag]))
  await em.nativeDelete(ResourcesResourceTagAssignment, { resource: params.resourceId })
  const resource = em.getReference(ResourcesResource, params.resourceId)
  for (const tagId of tagIds) {
    const tag = byId.get(tagId)
    if (!tag) continue
    const assignment = em.create(ResourcesResourceTagAssignment, {
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      resource,
      tag,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(assignment)
  }
}

const createResourceCommand: CommandHandler<ResourcesResourceCreateInput, { resourceId: string }> = {
  id: 'resources.resources.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(resourcesResourceCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    
    if (parsed.areaId) {
      const area = await em.findOne(ResourcesResourceArea, { id: parsed.areaId, deletedAt: null })
      if (!area) throw new CrudHttpError(404, { error: 'Resource area not found.' })
      if (area.organizationId !== parsed.organizationId) {
        throw new CrudHttpError(400, { error: 'Resource area does not belong to the same organization.' })
      }
    }

    const now = new Date()
    const unitValue =
      typeof parsed.capacityUnitValue === 'string' ? parsed.capacityUnitValue.trim() : ''
    const unitSnapshot = unitValue
      ? await resolveCapacityUnit(em, { tenantId: parsed.tenantId, organizationId: parsed.organizationId }, unitValue)
      : null
    const hasExplicitSortOrder = Boolean(rawInput && typeof rawInput === 'object' && 'sortOrder' in rawInput)
    const sortOrder = hasExplicitSortOrder
      ? parsed.sortOrder ?? 0
      : await resolveNextResourceSortOrder(em, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          areaId: parsed.areaId ?? null,
        })

    const record = em.create(ResourcesResource, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      resourceTypeId: parsed.resourceTypeId ?? null,
      areaId: parsed.areaId ?? null,
      sortOrder,
      capacity: parsed.capacity ?? null,
      capacityUnitValue: unitSnapshot?.value ?? null,
      capacityUnitName: unitSnapshot?.name ?? null,
      capacityUnitColor: unitSnapshot?.color ?? null,
      capacityUnitIcon: unitSnapshot?.icon ?? null,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      isActive: parsed.isActive ?? true,
      availabilityRuleSetId: parsed.availabilityRuleSetId ?? null,
      customFieldsetCode: parsed.customFieldsetCode ?? null,
      createdAt: now,
      updatedAt: now,
    })
    await withAtomicFlush(em, [
      async () => {
        em.persist(record)
        await em.flush()
      },
      () => syncResourcesResourceTags(em, {
        resourceId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        tagIds: parsed.tags,
      }),
    ], { transaction: true })
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.resources.resources_resource,
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
      events: resourcesResourceCrudEvents,
      indexer: resourceCrudIndexer,
    })
    return { resourceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadResourceSnapshot(em, result.resourceId)
    if (!snapshot) return null
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    return { snapshot, custom }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadResourceSnapshot(em, result?.resourceId ?? '')
    if (!snapshot) return null
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    const snapshotWithCustom: ResourceSnapshot = custom
      ? { ...snapshot, customFields: custom }
      : snapshot
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resources.create', 'Create resource'),
      resourceKind: 'resources.resource',
      resourceId: snapshotWithCustom.id,
      tenantId: snapshotWithCustom.tenantId,
      organizationId: snapshotWithCustom.organizationId,
      snapshotAfter: snapshotWithCustom,
      payload: {
        undo: {
          after: snapshotWithCustom,
          customAfter: custom,
        } satisfies ResourceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResource, { id: after.id })
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
        events: resourcesResourceCrudEvents,
      indexer: resourceCrudIndexer,
      })
    }
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceUndoPayload>(logEntry)
    const after = resolveRedoSnapshot<ResourceSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for resource create' })
    }
    const fallbackCustomAfter = (after as ResourceSnapshot).customFields ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(ResourcesResource, { id: after.id })
    await withAtomicFlush(em, [
      async () => {
        if (!record) {
          record = em.create(ResourcesResource, {
            id: after.id,
            tenantId: after.tenantId,
            organizationId: after.organizationId,
            name: after.name,
            description: after.description ?? null,
            resourceTypeId: after.resourceTypeId ?? null,
            areaId: after.areaId ?? null,
            sortOrder: after.sortOrder ?? 0,
            capacity: after.capacity ?? null,
            capacityUnitValue: after.capacityUnitValue ?? null,
            capacityUnitName: after.capacityUnitName ?? null,
            capacityUnitColor: after.capacityUnitColor ?? null,
            capacityUnitIcon: after.capacityUnitIcon ?? null,
            appearanceIcon: after.appearanceIcon ?? null,
            appearanceColor: after.appearanceColor ?? null,
            isActive: after.isActive,
            availabilityRuleSetId: after.availabilityRuleSetId ?? null,
            customFieldsetCode: after.customFieldsetCode ?? null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          em.persist(record)
        } else {
          record.name = after.name
          record.description = after.description ?? null
          record.resourceTypeId = after.resourceTypeId ?? null
          record.areaId = after.areaId ?? null
          record.sortOrder = after.sortOrder ?? 0
          record.capacity = after.capacity ?? null
          record.capacityUnitValue = after.capacityUnitValue ?? null
          record.capacityUnitName = after.capacityUnitName ?? null
          record.capacityUnitColor = after.capacityUnitColor ?? null
          record.capacityUnitIcon = after.capacityUnitIcon ?? null
          record.appearanceIcon = after.appearanceIcon ?? null
          record.appearanceColor = after.appearanceColor ?? null
          record.isActive = after.isActive
          record.availabilityRuleSetId = after.availabilityRuleSetId ?? null
          record.customFieldsetCode = after.customFieldsetCode ?? null
          record.deletedAt = null
          record.updatedAt = new Date()
        }
        await em.flush()
      },
      () => syncResourcesResourceTags(em, {
        resourceId: (record as ResourcesResource).id,
        organizationId: (record as ResourcesResource).organizationId,
        tenantId: (record as ResourcesResource).tenantId,
        tagIds: after.tags,
      }),
    ], { transaction: true })
    const resolvedRecord = record as ResourcesResource

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    const customAfter = payload?.customAfter ?? fallbackCustomAfter ?? undefined
    if (customAfter) {
      const reset = buildCustomFieldResetMap(customAfter, undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.resources.resources_resource,
        recordId: resolvedRecord.id,
        tenantId: resolvedRecord.tenantId,
        organizationId: resolvedRecord.organizationId,
        values: reset,
      })
    }

    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: resolvedRecord,
      identifiers: {
        id: resolvedRecord.id,
        organizationId: resolvedRecord.organizationId,
        tenantId: resolvedRecord.tenantId,
      },
      events: resourcesResourceCrudEvents,
      indexer: resourceCrudIndexer,
    })
    return { resourceId: resolvedRecord.id }
  },
}

const updateResourceCommand: CommandHandler<ResourcesResourceUpdateInput, { resourceId: string }> = {
  id: 'resources.resources.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(resourcesResourceUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceSnapshot(em, parsed.id)
    if (!snapshot) return {}
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(resourcesResourceUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      ResourcesResource,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Resources resource not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const areaChanged = parsed.areaId !== undefined && parsed.areaId !== record.areaId
    if (areaChanged) {
      if (parsed.areaId) {
        const area = await em.findOne(ResourcesResourceArea, { id: parsed.areaId, deletedAt: null })
        if (!area) throw new CrudHttpError(404, { error: 'Resource area not found.' })
        if (area.organizationId !== record.organizationId) {
          throw new CrudHttpError(400, { error: 'Resource area does not belong to the same organization.' })
        }
      }
      if (parsed.sortOrder === undefined) {
        record.sortOrder = await resolveNextResourceSortOrder(em, {
          tenantId: record.tenantId,
          organizationId: record.organizationId,
          areaId: parsed.areaId ?? null,
        })
      }
    }

    let capacityUnit: CapacityUnitSnapshot | null | undefined
    if (parsed.capacityUnitValue !== undefined) {
      const unitValue =
        typeof parsed.capacityUnitValue === 'string' ? parsed.capacityUnitValue.trim() : ''
      capacityUnit = unitValue
        ? await resolveCapacityUnit(
            em,
            { tenantId: record.tenantId, organizationId: record.organizationId },
            unitValue,
          )
        : null
    }
    await withAtomicFlush(em, [
      () => {
        if (parsed.capacityUnitValue !== undefined) {
          record.capacityUnitValue = capacityUnit?.value ?? null
          record.capacityUnitName = capacityUnit?.name ?? null
          record.capacityUnitColor = capacityUnit?.color ?? null
          record.capacityUnitIcon = capacityUnit?.icon ?? null
        }
        if (parsed.name !== undefined) record.name = parsed.name
        if (parsed.description !== undefined) record.description = parsed.description ?? null
        if (parsed.resourceTypeId !== undefined) record.resourceTypeId = parsed.resourceTypeId ?? null
        if (parsed.areaId !== undefined) record.areaId = parsed.areaId ?? null
        if (parsed.sortOrder !== undefined) record.sortOrder = parsed.sortOrder
        if (parsed.capacity !== undefined) record.capacity = parsed.capacity ?? null
        if (parsed.appearanceIcon !== undefined) record.appearanceIcon = parsed.appearanceIcon ?? null
        if (parsed.appearanceColor !== undefined) record.appearanceColor = parsed.appearanceColor ?? null
        if (parsed.availabilityRuleSetId !== undefined) record.availabilityRuleSetId = parsed.availabilityRuleSetId ?? null
        if (parsed.customFieldsetCode !== undefined) record.customFieldsetCode = parsed.customFieldsetCode ?? null
        record.updatedAt = new Date()
        if (parsed.isActive !== undefined) record.isActive = parsed.isActive
      },
      () => syncResourcesResourceTags(em, {
        resourceId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        tagIds: parsed.tags,
      }),
    ], { transaction: true })
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.resources.resources_resource,
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
      events: resourcesResourceCrudEvents,
      indexer: resourceCrudIndexer,
    })
    return { resourceId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as ResourceSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadResourceSnapshot(em, before.id)
    if (!after) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const customAfter = await loadResourceCustomSnapshot(em, after)
    const beforeWithCustom: ResourceSnapshot = customBefore
      ? { ...before, customFields: customBefore }
      : before
    const afterWithCustom: ResourceSnapshot = customAfter
      ? { ...after, customFields: customAfter }
      : after
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'name',
      'description',
      'resourceTypeId',
      'areaId',
      'sortOrder',
      'capacity',
      'capacityUnitValue',
      'capacityUnitName',
      'capacityUnitColor',
      'capacityUnitIcon',
      'appearanceIcon',
      'appearanceColor',
      'isActive',
      'availabilityRuleSetId',
      'customFieldsetCode',
      'deletedAt',
    ])
    if (before.tags.join(',') !== after.tags.join(',')) {
      changes.tags = { from: before.tags, to: after.tags }
    }
    const customChanges = diffCustomFieldChanges(customBefore, customAfter)
    if (Object.keys(customChanges).length) {
      changes.customFields = { from: customBefore ?? null, to: customAfter ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resources.update', 'Update resource'),
      resourceKind: 'resources.resource',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: beforeWithCustom,
      snapshotAfter: afterWithCustom,
      changes,
      payload: {
        undo: {
          before: beforeWithCustom,
          after: afterWithCustom,
          customBefore: customBefore ?? null,
          customAfter,
        } satisfies ResourceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const fallbackCustomBefore = (before as ResourceSnapshot).customFields ?? null
    const fallbackCustomAfter = (payload?.after as ResourceSnapshot | null | undefined)?.customFields ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResource, { id: before.id })
    if (!record) return
    await withAtomicFlush(em, [
      () => {
        record.name = before.name
        record.description = before.description ?? null
        record.resourceTypeId = before.resourceTypeId ?? null
        record.areaId = before.areaId ?? null
        record.sortOrder = before.sortOrder ?? 0
        record.capacity = before.capacity ?? null
        record.capacityUnitValue = before.capacityUnitValue ?? null
        record.capacityUnitName = before.capacityUnitName ?? null
        record.capacityUnitColor = before.capacityUnitColor ?? null
        record.capacityUnitIcon = before.capacityUnitIcon ?? null
        record.appearanceIcon = before.appearanceIcon ?? null
        record.appearanceColor = before.appearanceColor ?? null
        record.isActive = before.isActive
        record.availabilityRuleSetId = before.availabilityRuleSetId ?? null
        record.customFieldsetCode = before.customFieldsetCode ?? null
        record.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
        record.updatedAt = new Date()
      },
      () => syncResourcesResourceTags(em, {
        resourceId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        tagIds: before.tags,
      }),
    ], { transaction: true })

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    const customBefore = payload.customBefore ?? fallbackCustomBefore ?? undefined
    const customAfter = payload.customAfter ?? fallbackCustomAfter ?? undefined
    if (customBefore || customAfter) {
      const reset = buildCustomFieldResetMap(customBefore, customAfter)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.resources.resources_resource,
        recordId: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: resourcesResourceCrudEvents,
      indexer: resourceCrudIndexer,
    })
  },
}

const deleteResourceCommand: CommandHandler<{ id?: string }, { resourceId: string }> = {
  id: 'resources.resources.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadResourceSnapshot(em, id)
    if (!snapshot) return {}
    const custom = await loadResourceCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      ResourcesResource,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Resources resource not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
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
      events: resourcesResourceCrudEvents,
      indexer: resourceCrudIndexer,
    })
    return { resourceId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ResourceSnapshot | undefined
    if (!before) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const beforeWithCustom: ResourceSnapshot = customBefore
      ? { ...before, customFields: customBefore }
      : before
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resources.delete', 'Delete resource'),
      resourceKind: 'resources.resource',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: beforeWithCustom,
      payload: {
        undo: {
          before: beforeWithCustom,
          customBefore: customBefore ?? null,
        } satisfies ResourceUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const fallbackCustomBefore = (before as ResourceSnapshot).customFields ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(ResourcesResource, { id: before.id })
    await withAtomicFlush(em, [
      async () => {
        if (!record) {
          record = em.create(ResourcesResource, {
            id: before.id,
            tenantId: before.tenantId,
            organizationId: before.organizationId,
            name: before.name,
            description: before.description ?? null,
            resourceTypeId: before.resourceTypeId ?? null,
            areaId: before.areaId ?? null,
            sortOrder: before.sortOrder ?? 0,
            capacity: before.capacity ?? null,
            capacityUnitValue: before.capacityUnitValue ?? null,
            capacityUnitName: before.capacityUnitName ?? null,
            capacityUnitColor: before.capacityUnitColor ?? null,
            capacityUnitIcon: before.capacityUnitIcon ?? null,
            appearanceIcon: before.appearanceIcon ?? null,
            appearanceColor: before.appearanceColor ?? null,
            isActive: before.isActive,
            availabilityRuleSetId: before.availabilityRuleSetId ?? null,
            customFieldsetCode: before.customFieldsetCode ?? null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          em.persist(record)
        } else {
          record.name = before.name
          record.description = before.description ?? null
          record.resourceTypeId = before.resourceTypeId ?? null
          record.areaId = before.areaId ?? null
          record.sortOrder = before.sortOrder ?? 0
          record.capacity = before.capacity ?? null
          record.capacityUnitValue = before.capacityUnitValue ?? null
          record.capacityUnitName = before.capacityUnitName ?? null
          record.capacityUnitColor = before.capacityUnitColor ?? null
          record.capacityUnitIcon = before.capacityUnitIcon ?? null
          record.appearanceIcon = before.appearanceIcon ?? null
          record.appearanceColor = before.appearanceColor ?? null
          record.isActive = before.isActive
          record.availabilityRuleSetId = before.availabilityRuleSetId ?? null
          record.customFieldsetCode = before.customFieldsetCode ?? null
          record.deletedAt = null
          record.updatedAt = new Date()
        }
        await em.flush()
      },
      () => syncResourcesResourceTags(em, {
        resourceId: (record as ResourcesResource).id,
        organizationId: (record as ResourcesResource).organizationId,
        tenantId: (record as ResourcesResource).tenantId,
        tagIds: before.tags,
      }),
    ], { transaction: true })
    const resolvedRecord = record as ResourcesResource

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    const customBefore = payload.customBefore ?? fallbackCustomBefore ?? undefined
    if (customBefore) {
      const reset = buildCustomFieldResetMap(customBefore, undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.resources.resources_resource,
        recordId: resolvedRecord.id,
        tenantId: resolvedRecord.tenantId,
        organizationId: resolvedRecord.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: resolvedRecord,
      identifiers: {
        id: resolvedRecord.id,
        organizationId: resolvedRecord.organizationId,
        tenantId: resolvedRecord.tenantId,
      },
      events: resourcesResourceCrudEvents,
      indexer: resourceCrudIndexer,
    })
  },
}

const reorderResourcesCommand: CommandHandler<ResourcesResourceReorderInput, { updatedIds: string[] }> = {
  id: 'resources.resources.reorder',
  async prepare(rawInput, ctx) {
    const parsed = resourcesResourceReorderSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager)
    const record = await em.findOne(ResourcesResource, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) return {}
    const siblings = await em.find(
      ResourcesResource,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        areaId: record.areaId ?? null,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'ASC', name: 'ASC', id: 'ASC' } },
    )
    return { before: snapshotResourceOrder(siblings) }
  },
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceReorderSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResource, {
      id: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!record) throw new CrudHttpError(404, { error: 'Resources resource not found.' })
    if (parsed.targetId) {
      const target = await em.findOne(ResourcesResource, {
        id: parsed.targetId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        areaId: record.areaId ?? null,
        deletedAt: null,
      })
      if (!target) throw new CrudHttpError(404, { error: 'Resource reorder target not found.' })
    }

    const siblings = await em.find(
      ResourcesResource,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        areaId: record.areaId ?? null,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'ASC', name: 'ASC', id: 'ASC' } },
    )
    const reordered = moveSiblingOrder(siblings, parsed)
    const now = new Date()
    reordered.forEach((resource, index) => {
      resource.sortOrder = index
      resource.updatedAt = now
    })
    await em.flush()
    return { updatedIds: reordered.map((resource) => resource.id) }
  },
  captureAfter: async (input, _result, ctx) => {
    const parsed = resourcesResourceReorderSchema.parse(input ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ResourcesResource, { id: parsed.id })
    if (!record) return null
    const siblings = await em.find(
      ResourcesResource,
      {
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        areaId: record.areaId ?? null,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'ASC', name: 'ASC', id: 'ASC' } },
    )
    return { after: snapshotResourceOrder(siblings) }
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = resourcesResourceReorderSchema.parse(input ?? {})
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resources.reorder', 'Reorder resources'),
      resourceKind: 'resources.resource',
      resourceId: parsed.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      snapshotBefore: snapshots.before,
      snapshotAfter: snapshots.after,
      payload: {
        undo: {
          before: snapshots.before as ResourceReorderSnapshot | null | undefined,
          after: snapshots.after as ResourceReorderSnapshot | null | undefined,
        } satisfies ResourceReorderUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceReorderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ids = before.resources.map((resource) => resource.id)
    const resources = await em.find(ResourcesResource, { id: { $in: ids } })
    const byId = new Map(resources.map((resource) => [resource.id, resource]))
    const now = new Date()
    before.resources.forEach((snapshot) => {
      const resource = byId.get(snapshot.id)
      if (!resource) return
      resource.sortOrder = snapshot.sortOrder
      resource.updatedAt = now
    })
    await em.flush()
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceReorderUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return { updatedIds: [] }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ids = after.resources.map((resource) => resource.id)
    const resources = await em.find(ResourcesResource, { id: { $in: ids } })
    const byId = new Map(resources.map((resource) => [resource.id, resource]))
    const now = new Date()
    after.resources.forEach((snapshot) => {
      const resource = byId.get(snapshot.id)
      if (!resource) return
      resource.sortOrder = snapshot.sortOrder
      resource.updatedAt = now
    })
    await em.flush()
    return { updatedIds: ids }
  },
}

registerCommand(createResourceCommand)
registerCommand(updateResourceCommand)
registerCommand(deleteResourceCommand)
registerCommand(reorderResourcesCommand)
