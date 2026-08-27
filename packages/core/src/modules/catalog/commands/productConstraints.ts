import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  constraintInputSchema,
  productConstraintsSyncSchema,
  type ConstraintInput,
  type ProductConstraintsSyncInput,
} from '../data/validators'
import {
  CatalogProduct,
  CatalogProductOption,
  CatalogProductConstraint,
} from '../data/entities'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

type SerializedConstraint = {
  id: string
  constraintType: string
  sourceProductId: string | null
  sourceOptionId: string | null
  targetProductId: string | null
  targetOptionId: string | null
  locked: boolean
}

type ConstraintsSnapshot = SerializedConstraint[]

type ConstraintsUndoPayload = {
  before?: ConstraintsSnapshot | null
  after?: ConstraintsSnapshot | null
}

type ConstraintsScope = {
  productId: string
  tenantId: string
  organizationId: string
}

type CurrentConstraintRecords = CatalogProductConstraint[]

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
  constraints: Array<{ updatedAt?: Date | string | null }>,
): string | null {
  const candidates = [
    toIso(productUpdatedAt),
    ...constraints.map((c) => toIso(c.updatedAt)),
  ].filter((value): value is string => value !== null)

  if (candidates.length === 0) return null
  return candidates.reduce((latest, current) => (current > latest ? current : latest))
}

function normalizeSyncInput(
  parsed: ProductConstraintsSyncInput,
): { constraints: SerializedConstraint[] } {
  return {
    constraints: parsed.constraints.map((c) => ({
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

async function loadCurrentConstraintRecords(
  em: EntityManager,
  scope: ConstraintsScope,
): Promise<CurrentConstraintRecords> {
  return em.find(CatalogProductConstraint, {
    sourceProduct: scope.productId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

async function loadConstraintsSnapshot(
  em: EntityManager,
  scope: ConstraintsScope,
): Promise<ConstraintsSnapshot> {
  const constraints = await loadCurrentConstraintRecords(em, scope)
  return constraints.map((c) => ({
    id: c.id,
    constraintType: c.constraintType,
    sourceProductId: c.sourceProduct?.id ?? null,
    sourceOptionId: c.sourceOption?.id ?? null,
    targetProductId: c.targetProduct?.id ?? null,
    targetOptionId: c.targetOption?.id ?? null,
    locked: c.locked,
  }))
}

async function applyConstraintsSnapshot(
  em: EntityManager,
  scope: ConstraintsScope,
  snapshot: SerializedConstraint[],
): Promise<void> {
  const currentConstraints = await loadCurrentConstraintRecords(em, scope)
  const incomingIds = new Set(snapshot.map((c) => c.id))

  // Remove constraints not in incoming
  for (const constraint of currentConstraints) {
    if (!incomingIds.has(constraint.id)) {
      em.remove(constraint)
    }
  }

  await em.flush()

  const constraintEntities = new Map<string, CatalogProductConstraint>()
  for (const constraint of currentConstraints) {
    if (incomingIds.has(constraint.id)) {
      constraintEntities.set(constraint.id, constraint)
    }
  }

  for (const serialized of snapshot) {
    let entity = constraintEntities.get(serialized.id)

    if (!entity) {
      entity = em.create(CatalogProductConstraint, {
        id: serialized.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        constraintType: serialized.constraintType as any,
        locked: serialized.locked,
      })
      em.persist(entity)
      constraintEntities.set(serialized.id, entity)
    }

    entity.constraintType = serialized.constraintType as any
    entity.locked = serialized.locked

    // Set source
    if (serialized.sourceProductId) {
      const sourceProduct = await em.findOne(CatalogProduct, { id: serialized.sourceProductId })
      if (!sourceProduct) {
        throw new CrudHttpError(400, {
          error: `Invalid sourceProductId: ${serialized.sourceProductId}`,
        })
      }
      entity.sourceProduct = sourceProduct
      entity.sourceOption = null
    } else if (serialized.sourceOptionId) {
      const sourceOption = await em.findOne(CatalogProductOption, { id: serialized.sourceOptionId })
      if (!sourceOption) {
        throw new CrudHttpError(400, {
          error: `Invalid sourceOptionId: ${serialized.sourceOptionId}`,
        })
      }
      entity.sourceOption = sourceOption
      entity.sourceProduct = null
    }

    // Set target
    if (serialized.targetProductId) {
      const targetProduct = await em.findOne(CatalogProduct, { id: serialized.targetProductId })
      if (!targetProduct) {
        throw new CrudHttpError(400, {
          error: `Invalid targetProductId: ${serialized.targetProductId}`,
        })
      }
      entity.targetProduct = targetProduct
      entity.targetOption = null
    } else if (serialized.targetOptionId) {
      const targetOption = await em.findOne(CatalogProductOption, { id: serialized.targetOptionId })
      if (!targetOption) {
        throw new CrudHttpError(400, {
          error: `Invalid targetOptionId: ${serialized.targetOptionId}`,
        })
      }
      entity.targetOption = targetOption
      entity.targetProduct = null
    }
  }

  await em.flush()
}

const syncConstraintsCommand: CommandHandler<
  ProductConstraintsSyncInput,
  void
> = {
  id: 'catalog.product_constraints.sync',
  prepare: async (input, ctx) => {
    const parsed = productConstraintsSyncSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadConstraintsSnapshot(em, {
      productId: parsed.productId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    return { before }
  },
  async execute(input, ctx) {
    const parsed = productConstraintsSyncSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = {
      productId: parsed.productId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    } satisfies ConstraintsScope
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
    for (const constraint of snapshot.constraints) {
      if (constraint.sourceOptionId) {
        const option = await em.findOne(CatalogProductOption, { id: constraint.sourceOptionId })
        if (!option || option.tenantId !== parsed.tenantId || option.organizationId !== parsed.organizationId) {
          throw new CrudHttpError(400, { error: `Foreign or invalid sourceOptionId: ${constraint.sourceOptionId}` })
        }
      }
      if (constraint.targetOptionId) {
        const option = await em.findOne(CatalogProductOption, { id: constraint.targetOptionId })
        if (!option || option.tenantId !== parsed.tenantId || option.organizationId !== parsed.organizationId) {
          throw new CrudHttpError(400, { error: `Foreign or invalid targetOptionId: ${constraint.targetOptionId}` })
        }
      }
    }

    await em.transactional(async (tem) => {
      const currentConstraints = await loadCurrentConstraintRecords(tem, scope)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: 'catalog.product',
        resourceId: product.id,
        current: getLatestUpdatedAt(product.updatedAt, currentConstraints),
        request: ctx.request ?? null,
      })

      await applyConstraintsSnapshot(tem, scope, snapshot.constraints)

      // Update product timestamp
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
    const parsed = productConstraintsSyncSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadConstraintsSnapshot(em, {
      productId: parsed.productId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = productConstraintsSyncSchema.parse(input)
    const after = snapshots.after as ConstraintsSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.productConstraints.sync', 'Sync Product Constraints'),
      resourceKind: 'catalog.product',
      resourceId: parsed.productId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { before: snapshots.before as ConstraintsSnapshot, after } satisfies ConstraintsUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const data = extractUndoPayload<ConstraintsUndoPayload>(logEntry)
    if (!data?.before) return
    const productId = typeof logEntry.resourceId === 'string' ? logEntry.resourceId : null
    const tenantId = typeof logEntry.tenantId === 'string' ? logEntry.tenantId : null
    const organizationId = typeof logEntry.organizationId === 'string' ? logEntry.organizationId : null
    if (!productId || !tenantId || !organizationId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { productId, tenantId, organizationId } satisfies ConstraintsScope

    await em.transactional(async (tem) => {
      await applyConstraintsSnapshot(tem, scope, data.before as SerializedConstraint[])
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

registerCommand(syncConstraintsCommand)

// Also export for use in option tree sync
export { applyConstraintsSnapshot, loadConstraintsSnapshot }
export type { ConstraintsScope, SerializedConstraint, ConstraintsSnapshot }
