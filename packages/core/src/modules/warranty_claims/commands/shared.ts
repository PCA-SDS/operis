import { randomUUID } from 'crypto'
import type { FindOneOptions } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, flushCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  WarrantyClaim,
  WarrantyClaimEvent,
  WarrantyClaimLine,
} from '../data/entities'
import type { WarrantyClaimEventKind, WarrantyClaimEventVisibility, WarrantyClaimWarrantyStatus } from '../data/validators'
import { computeHeaderRollups } from '../lib/stateMachine'
import { addWarrantyMonths } from '../lib/warrantyPreview'
import { E } from '#generated/entities.ids.generated'

export { assertFound } from '@open-mercato/shared/lib/crud/errors'
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export const WARRANTY_CLAIM_RESOURCE_KIND = 'warranty_claims.claim'
export const WARRANTY_CLAIM_LINE_RESOURCE_KIND = 'warranty_claims.claim_line'

export type WarrantyClaimScope = {
  organizationId: string
  tenantId: string
}

export type VersionedRecord = {
  id: string
  updatedAt?: Date | string | null
}

export type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export type AppendClaimEventInput = {
  visibility?: WarrantyClaimEventVisibility
  body?: string | null
  payload?: Record<string, unknown> | null
  actorUserId?: string | null
  actorCustomerId?: string | null
}

export async function enforceWarrantyClaimOptimisticLock(
  ctx: CommandRuntimeContext,
  record: VersionedRecord | null | undefined,
  resourceKind = WARRANTY_CLAIM_RESOURCE_KIND,
  expected?: string | Date | null,
): Promise<void> {
  if (!record) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    expected,
    request: ctx.request ?? null,
  })
}

export async function loadScopedClaim(
  em: EntityManager,
  id: string,
  scope: WarrantyClaimScope,
  options: FindOneOptions<WarrantyClaim> = {},
): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    em,
    WarrantyClaim,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    options,
    scope,
  )
}

export async function requireScopedClaim(
  em: EntityManager,
  id: string,
  scope: WarrantyClaimScope,
  options: FindOneOptions<WarrantyClaim> = {},
): Promise<WarrantyClaim> {
  const claim = await loadScopedClaim(em, id, scope, options)
  return assertFound(claim, 'warranty_claims.errors.notFound')
}

export function appendClaimEvent(
  em: EntityManager,
  claim: WarrantyClaim,
  kind: WarrantyClaimEventKind,
  input: AppendClaimEventInput = {},
): WarrantyClaimEvent {
  const event = em.create(WarrantyClaimEvent, {
    id: randomUUID(),
    claim,
    organizationId: claim.organizationId,
    tenantId: claim.tenantId,
    kind,
    visibility: input.visibility ?? 'internal',
    body: input.body ?? null,
    payload: input.payload ?? null,
    actorUserId: input.actorUserId ?? null,
    actorCustomerId: input.actorCustomerId ?? null,
    createdAt: new Date(),
  })
  em.persist(event)
  return event
}

export async function reconcileVendorRecoverySourceClaim(
  ctx: ResolverContext,
  input: { claimId: string; tenantId: string; organizationId: string },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const recoveryClaim = await findOneWithDecryption(
    em,
    WarrantyClaim,
    { id: input.claimId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!recoveryClaim || recoveryClaim.claimType !== 'vendor_recovery' || !recoveryClaim.sourceClaimId) return

  const sourceClaim = await findOneWithDecryption(
    em,
    WarrantyClaim,
    { id: recoveryClaim.sourceClaimId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!sourceClaim) return

  const resolvedChildren = await findWithDecryption(
    em,
    WarrantyClaim,
    {
      sourceClaimId: sourceClaim.id,
      claimType: 'vendor_recovery',
      status: { $in: ['resolved', 'closed'] },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )
  const childLines = resolvedChildren.length
    ? await findWithDecryption(
        em,
        WarrantyClaimLine,
        {
          claim: { $in: resolvedChildren.map((child) => child.id) },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        {},
        scope,
      )
    : []
  const recoveredTotal = computeHeaderRollups(childLines).totalApprovedAmount
  await withAtomicFlush(
    em,
    [
      () => {
        sourceClaim.totalRecoveredAmount = String(recoveredTotal)
        sourceClaim.updatedAt = new Date()
      },
    ],
    { transaction: true, label: 'warranty_claims.vendor_recovery.reconciliation' },
  )

  const dataEngine = ctx.resolve<DataEngine>('dataEngine')
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: sourceClaim,
    identifiers: {
      id: sourceClaim.id,
      organizationId: sourceClaim.organizationId,
      tenantId: sourceClaim.tenantId,
    },
    indexer: { entityType: 'warranty_claims:warranty_claim' },
    events: {
      module: 'warranty_claims',
      entity: 'claim',
      persistent: true,
      buildPayload: () => ({
        id: sourceClaim.id,
        organizationId: sourceClaim.organizationId,
        tenantId: sourceClaim.tenantId,
        claimType: sourceClaim.claimType,
        status: sourceClaim.status,
      }),
    },
  })
  await flushCrudSideEffects(dataEngine)
  await invalidateCrudCache(
    ctx as unknown as Parameters<typeof invalidateCrudCache>[0],
    'warranty_claims.claim',
    { id: sourceClaim.id, organizationId: sourceClaim.organizationId, tenantId: sourceClaim.tenantId },
    input.tenantId,
    'warranty_claims.vendor_recovery.reconciliation',
  )
}

export function toDateOnly(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function amountString(value: number | string | null | undefined, fallback = '0'): string | null {
  if (value === null) return null
  if (value === undefined) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return String(parsed)
}

export function nullableAmountString(value: number | string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return amountString(value, '0')
}

export function computeWarrantyDates(
  purchaseDate: Date | null | undefined,
  warrantyMonths: number | null | undefined,
): { warrantyExpiresAt: Date | null; warrantyStatus: WarrantyClaimWarrantyStatus } {
  if (!purchaseDate || warrantyMonths === null || warrantyMonths === undefined) {
    return { warrantyExpiresAt: null, warrantyStatus: 'unknown' }
  }
  const warrantyExpiresAt = addWarrantyMonths(purchaseDate, warrantyMonths)
  const warrantyStatus = warrantyExpiresAt.getTime() >= Date.now() ? 'in_warranty' : 'out_of_warranty'
  return { warrantyExpiresAt, warrantyStatus }
}

export async function emitLineCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  line: WarrantyClaimLine,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: line,
    identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    indexer: { entityType: E.warranty_claims.warranty_claim_line },
  })
  await invalidateCrudCache(
    ctx.container,
    'warranty_claims.claim_line',
    { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    ctx.auth?.tenantId ?? null,
    `warranty_claims.claim_line.${action}`,
  )
}

export async function emitLineUndoCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  line: WarrantyClaimLine,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: line,
    identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    indexer: { entityType: E.warranty_claims.warranty_claim_line },
  })
  await invalidateCrudCache(
    ctx.container,
    'warranty_claims.claim_line',
    { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    ctx.auth?.tenantId ?? null,
    `warranty_claims.claim_line.undo.${action}`,
  )
}
