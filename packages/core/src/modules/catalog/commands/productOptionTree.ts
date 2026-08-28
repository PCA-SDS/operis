import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  catalogProductOptionTreeSyncSchema,
  type CatalogProductOptionTreeSyncInput,
} from '../data/validators'
import {
  CatalogProduct,
  CatalogProductOptionGroup,
  CatalogProductOption,
} from '../data/entities'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  applyConstraintsSnapshot,
  loadConstraintsSnapshot,
  loadCurrentConstraintRecords,
} from './productConstraints'
import type { SerializedConstraint } from './productConstraints'

type SerializedGroup = {
  id: string
  parentOptionId: string | null
  name: string
  description: string | null
  requirement: 'required' | 'optional'
  selectMode: 'single' | 'multiple'
  sortOrder: number
  isActive: boolean
  metadata: Record<string, unknown> | null
}

type SerializedOption = {
  id: string
  groupId: string
  code: string | null
  name: string
  description: string | null
  note: string | null
  unit: string | null
  priceFlat: string | null
  priceMin: string | null
  priceMax: string | null
  durationValue: number | null
  durationUnit: string | null
  durationMin: number | null
  durationMax: number | null
  isAddon: boolean
  sortOrder: number
  isActive: boolean
  metadata: Record<string, unknown> | null
}

type OptionTreeSnapshot = {
  groups: SerializedGroup[]
  options: SerializedOption[]
  constraints?: SerializedConstraint[]
}

type OptionTreeUndoPayload = {
  before?: OptionTreeSnapshot | null
  after?: OptionTreeSnapshot | null
}

type OptionTreeScope = {
  productId: string
  tenantId: string
  organizationId: string
}

type CurrentOptionTreeRecords = {
  groups: CatalogProductOptionGroup[]
  options: CatalogProductOption[]
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getLatestUpdatedAt(
  productUpdatedAt: Date | string | null | undefined,
  groups: Array<{ updatedAt?: Date | string | null }>,
  options: Array<{ updatedAt?: Date | string | null }>,
): string | null {
  const candidates = [
    toIso(productUpdatedAt),
    ...groups.map((group) => toIso(group.updatedAt)),
    ...options.map((option) => toIso(option.updatedAt)),
  ].filter((value): value is string => value !== null)

  if (candidates.length === 0) return null
  return candidates.reduce((latest, current) => (current > latest ? current : latest))
}

function normalizeSyncInput(parsed: CatalogProductOptionTreeSyncInput): OptionTreeSnapshot {
  return {
    groups: parsed.groups.map((group) => ({
      id: group.id,
      parentOptionId: group.parentOptionId ?? null,
      name: group.name,
      description: group.description ?? null,
      requirement: group.requirement ?? 'required',
      selectMode: group.selectMode ?? 'single',
      sortOrder: group.sortOrder ?? 0,
      isActive: group.isActive ?? true,
      metadata: group.metadata ? cloneJson(group.metadata) : null,
    })),
    options: parsed.options.map((option) => ({
      id: option.id,
      groupId: option.groupId,
      code: option.code ?? null,
      name: option.name,
      description: option.description ?? null,
      note: option.note ?? null,
      unit: option.unit ?? null,
      priceFlat: option.priceFlat ?? null,
      priceMin: option.priceMin ?? null,
      priceMax: option.priceMax ?? null,
      durationValue: option.durationValue ?? null,
      durationUnit: option.durationUnit ?? null,
      durationMin: option.durationMin ?? null,
      durationMax: option.durationMax ?? null,
      isAddon: option.isAddon ?? false,
      sortOrder: option.sortOrder ?? 0,
      isActive: option.isActive ?? true,
      metadata: option.metadata ? cloneJson(option.metadata) : null,
    })),
    constraints: parsed.constraints?.map((c) => ({
      id: c.id ?? crypto.randomUUID(),
      constraintType: c.constraintType,
      sourceProductId: c.sourceProductId ?? null,
      sourceOptionId: c.sourceOptionId ?? null,
      targetProductId: c.targetProductId ?? null,
      targetOptionId: c.targetOptionId ?? null,
      locked: c.locked ?? false,
    })),
  }
}

async function loadCurrentOptionTreeRecords(
  em: EntityManager,
  scope: OptionTreeScope,
): Promise<CurrentOptionTreeRecords> {
  const groups = await em.find(
    CatalogProductOptionGroup,
    {
      product: scope.productId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
  )
  const groupIds = groups.map((group) => group.id)
  const options =
    groupIds.length > 0
      ? await em.find(
          CatalogProductOption,
          {
            group: { $in: groupIds },
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            deletedAt: null,
          },
          { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
        )
      : []

  return { groups, options }
}

async function applyOptionTreeSnapshot(
  em: EntityManager,
  scope: OptionTreeScope,
  snapshot: OptionTreeSnapshot,
): Promise<void> {
  const currentTree = await loadCurrentOptionTreeRecords(em, scope)
  const incomingGroupIds = new Set(snapshot.groups.map((group) => group.id))
  const incomingOptionIds = new Set(snapshot.options.map((option) => option.id))

  for (const option of currentTree.options) {
    if (!incomingOptionIds.has(option.id)) {
      em.remove(option)
    }
  }

  for (const group of currentTree.groups) {
    if (!incomingGroupIds.has(group.id)) {
      em.remove(group)
    }
  }

  await em.flush()

  const groupEntities = new Map<string, CatalogProductOptionGroup>()
  for (const group of currentTree.groups) {
    if (incomingGroupIds.has(group.id)) {
      groupEntities.set(group.id, group)
    }
  }

  for (const group of snapshot.groups) {
    let entity = groupEntities.get(group.id)
    if (!entity) {
      entity = em.create(CatalogProductOptionGroup, {
        id: group.id,
        product: scope.productId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: group.name,
        sortOrder: group.sortOrder,
        isActive: group.isActive,
      })
      em.persist(entity)
      groupEntities.set(group.id, entity)
    }

    entity.name = group.name
    entity.description = group.description ?? null
    entity.requirement = group.requirement
    entity.selectMode = group.selectMode
    entity.sortOrder = group.sortOrder
    entity.isActive = group.isActive
    entity.metadata = group.metadata ? cloneJson(group.metadata) : null
  }

  await em.flush()

  const optionEntities = new Map<string, CatalogProductOption>()
  for (const option of currentTree.options) {
    if (incomingOptionIds.has(option.id)) {
      optionEntities.set(option.id, option)
    }
  }

  for (const option of snapshot.options) {
    let entity = optionEntities.get(option.id)
    const groupRef = groupEntities.get(option.groupId)
    if (!groupRef) {
      throw new CrudHttpError(400, { error: `Invalid groupId ${option.groupId} for option ${option.id}` })
    }

    if (!entity) {
      entity = em.create(CatalogProductOption, {
        id: option.id,
        group: groupRef,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: option.name,
        sortOrder: option.sortOrder,
        isActive: option.isActive,
      })
      em.persist(entity)
      optionEntities.set(option.id, entity)
    }

    entity.group = groupRef
    entity.code = option.code ?? null
    entity.name = option.name
    entity.description = option.description ?? null
    entity.note = option.note ?? null
    entity.unit = option.unit ?? null
    entity.priceFlat = option.priceFlat ?? null
    entity.priceMin = option.priceMin ?? null
    entity.priceMax = option.priceMax ?? null
    entity.durationValue = option.durationValue ?? null
    entity.durationUnit = option.durationUnit ?? null
    entity.durationMin = option.durationMin ?? null
    entity.durationMax = option.durationMax ?? null
    entity.isAddon = option.isAddon
    entity.sortOrder = option.sortOrder
    entity.isActive = option.isActive
    entity.metadata = option.metadata ? cloneJson(option.metadata) : null
  }

  await em.flush()

  for (const group of snapshot.groups) {
    const entity = groupEntities.get(group.id)
    if (!entity) continue

    if (group.parentOptionId) {
      const parentOption = optionEntities.get(group.parentOptionId)
      if (!parentOption) {
        throw new CrudHttpError(400, {
          error: `Invalid parentOptionId ${group.parentOptionId} for group ${group.id}`,
        })
      }
      entity.parentOption = parentOption
    } else {
      entity.parentOption = null
    }
  }

  await em.flush()
}

async function loadOptionTreeSnapshot(
  em: EntityManager,
  productId: string,
  tenantId: string,
  organizationId: string
): Promise<OptionTreeSnapshot> {
  const { groups, options } = await loadCurrentOptionTreeRecords(em, {
    productId,
    tenantId,
    organizationId,
  })

  const { loadConstraintsSnapshot } = await import('./productConstraints')
  const constraints = await loadConstraintsSnapshot(em, {
    productId,
    tenantId,
    organizationId,
  })

  return {
    groups: groups.map((g) => ({
      id: g.id,
      parentOptionId: g.parentOption?.id ?? null,
      name: g.name,
      description: g.description ?? null,
      requirement: g.requirement,
      selectMode: g.selectMode ?? 'single',
      sortOrder: g.sortOrder,
      isActive: g.isActive,
      metadata: g.metadata ? cloneJson(g.metadata) : null,
    })),
    options: options.map((o) => ({
      id: o.id,
      groupId: o.group.id,
      code: o.code ?? null,
      name: o.name,
      description: o.description ?? null,
      note: o.note ?? null,
      unit: o.unit ?? null,
      priceFlat: o.priceFlat ?? null,
      priceMin: o.priceMin ?? null,
      priceMax: o.priceMax ?? null,
      durationValue: o.durationValue ?? null,
      durationUnit: o.durationUnit ?? null,
      durationMin: o.durationMin ?? null,
      durationMax: o.durationMax ?? null,
      isAddon: o.isAddon ?? false,
      sortOrder: o.sortOrder,
      isActive: o.isActive,
      metadata: o.metadata ? cloneJson(o.metadata) : null,
    })),
    constraints,
  }
}

const syncOptionTreeCommand: CommandHandler<
  CatalogProductOptionTreeSyncInput,
  void
> = {
  id: 'catalog.product_options.sync_tree',
  prepare: async (input, ctx) => {
    const parsed = catalogProductOptionTreeSyncSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadOptionTreeSnapshot(em, parsed.productId, parsed.tenantId, parsed.organizationId)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = catalogProductOptionTreeSyncSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = {
      productId: parsed.productId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    } satisfies OptionTreeScope
    const snapshot = normalizeSyncInput(parsed)

    const product = await em.findOne(CatalogProduct, {
      id: parsed.productId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!product) {
      enforceRecordGoneIsConflict({
        resourceKind: 'catalog.product',
        resourceId: parsed.productId,
        request: ctx.request ?? null,
      })
      throw new CrudHttpError(404, { error: 'Product not found' })
    }

    // Validate foreign IDs
    const incomingGroupIds = snapshot.groups.map((group) => group.id)
    if (incomingGroupIds.length > 0) {
      const existingGroups = await em.find(CatalogProductOptionGroup, { id: { $in: incomingGroupIds } })
      for (const eg of existingGroups) {
        if (eg.product.id !== parsed.productId || eg.tenantId !== parsed.tenantId || eg.organizationId !== parsed.organizationId) {
          throw new CrudHttpError(400, { error: `Foreign group ID detected: ${eg.id}` })
        }
      }
    }

    const incomingOptionIds = snapshot.options.map((option) => option.id)
    if (incomingOptionIds.length > 0) {
      const existingOptions = await em.find(CatalogProductOption, { id: { $in: incomingOptionIds } })
      for (const eo of existingOptions) {
        if (eo.tenantId !== parsed.tenantId || eo.organizationId !== parsed.organizationId) {
          throw new CrudHttpError(400, { error: `Foreign option ID detected: ${eo.id}` })
        }
      }
    }

    // Apply sync
    await em.transactional(async (tem) => {
      const currentTree = await loadCurrentOptionTreeRecords(tem, scope)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: 'catalog.product',
        resourceId: product.id,
        current: getLatestUpdatedAt(product.updatedAt, currentTree.groups, currentTree.options),
        request: ctx.request ?? null,
      })

      await applyOptionTreeSnapshot(tem, scope, snapshot)

      // Sync constraints if provided
      if (snapshot.constraints && snapshot.constraints.length > 0) {
        const currentConstraints = await loadCurrentConstraintRecords(tem, scope)
        await applyConstraintsSnapshot(tem, scope, currentConstraints, snapshot.constraints)
      }

      const productRef = await tem.findOne(CatalogProduct, {
        id: parsed.productId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        deletedAt: null,
      })
      if (productRef) {
        productRef.updatedAt = new Date()
        await tem.flush()
      }
    })
  },
  captureAfter: async (input, result, ctx) => {
    const parsed = catalogProductOptionTreeSyncSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadOptionTreeSnapshot(em, parsed.productId, parsed.tenantId, parsed.organizationId)
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = catalogProductOptionTreeSyncSchema.parse(input)
    const after = snapshots.after as OptionTreeSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.productOptions.syncTree', 'Sync Product Option Tree'),
      resourceKind: 'catalog.product',
      resourceId: parsed.productId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { before: snapshots.before as OptionTreeSnapshot, after } satisfies OptionTreeUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const data = extractUndoPayload<OptionTreeUndoPayload>(logEntry)
    if (!data?.before) return
    const productId = typeof logEntry.resourceId === 'string' ? logEntry.resourceId : null
    const tenantId = typeof logEntry.tenantId === 'string' ? logEntry.tenantId : null
    const organizationId = typeof logEntry.organizationId === 'string' ? logEntry.organizationId : null
    if (!productId || !tenantId || !organizationId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { productId, tenantId, organizationId } satisfies OptionTreeScope

    await em.transactional(async (tem) => {
      await applyOptionTreeSnapshot(tem, scope, data.before as OptionTreeSnapshot)
      const product = await tem.findOne(CatalogProduct, {
        id: productId,
        tenantId,
        organizationId,
        deletedAt: null,
      })
      if (product) {
        product.updatedAt = new Date()
        await tem.flush()
      }
    })
  },
}

registerCommand(syncOptionTreeCommand)
