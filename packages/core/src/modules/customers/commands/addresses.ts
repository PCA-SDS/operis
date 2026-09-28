import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerAddress } from '../data/entities'
import { addressCreateSchema, addressUpdateSchema, type AddressCreateInput, type AddressUpdateInput } from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  ensureSameScope,
  extractUndoPayload,
  resolveParentResourceKind,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { assignPostalAddressFields, readPostalAddressFields, applyPostalAddressPatch } from '@open-mercato/shared/lib/location/postalAddress'

const addressCrudIndexer: CrudIndexerConfig<CustomerAddress> = {
  entityType: E.customers.customer_address,
}

const addressCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'address',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type AddressSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  entityId: string
  entityKind: string | null
  name: string | null
  purpose: string | null
  companyName: string | null
  addressLine1: string
  addressLine2: string | null
  buildingNumber: string | null
  flatNumber: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  isPrimary: boolean
}

type AddressUndoPayload = {
  before?: AddressSnapshot | null
  after?: AddressSnapshot | null
}

type AddressSnapshotScope = { tenantId?: string | null }

/** Tenant of the acting user, or `null` for a context without one (CLI/system). */
function snapshotScopeFromContext(ctx: { auth?: { tenantId?: string | null } | null }): AddressSnapshotScope | null {
  const tenantId = ctx.auth?.tenantId ?? null
  return tenantId ? { tenantId } : null
}

/** Tenant recorded on a snapshot, used when undo/redo reloads the row it wrote. */
function snapshotScopeFromSnapshot(source: { tenantId?: string | null } | null | undefined): AddressSnapshotScope | null {
  return source?.tenantId ? { tenantId: source.tenantId } : null
}

function scopedAddressWhere(id: string, scope?: AddressSnapshotScope | null): { id: string; tenantId?: string } {
  const where: { id: string; tenantId?: string } = { id }
  if (scope?.tenantId) where.tenantId = scope.tenantId
  return where
}

/**
 * Scoped by tenant — matching the staff address commands.
 *
 * This runs inside `prepare()`, i.e. BEFORE `ensureTenantScope` rejects the
 * write, and whatever it returns is written into the audit log as
 * `snapshotBefore`. Unscoped, a foreign-tenant address id would have its full
 * contents copied into this tenant's audit trail on the way to the 403.
 *
 * Deliberately tenant-only, not organization: an actor legitimately holding
 * several organizations must still capture a before-snapshot for a row in any
 * of them, and the tenant is the isolation boundary that matters here.
 */
async function loadAddressSnapshot(
  em: EntityManager,
  id: string,
  scope?: AddressSnapshotScope | null,
): Promise<AddressSnapshot | null> {
  const address = await em.findOne(CustomerAddress, scopedAddressWhere(id, scope), { populate: ['entity'] })
  if (!address) return null
  const entityRef = address.entity
  const entityKind = (typeof entityRef === 'object' && entityRef !== null && 'kind' in entityRef)
    ? (entityRef as { kind: string }).kind
    : null
  return {
    id: address.id,
    organizationId: address.organizationId,
    tenantId: address.tenantId,
    entityId: typeof entityRef === 'string' ? entityRef : entityRef.id,
    entityKind,
    ...readPostalAddressFields(address),
  }
}

async function enforcePrimaryAddress(em: EntityManager, entityId: string, addressId: string): Promise<void> {
  await em.nativeUpdate(
    CustomerAddress,
    { entity: entityId, id: { $ne: addressId }, isPrimary: true },
    { isPrimary: false }
  )
}

const createAddressCommand: CommandHandler<AddressCreateInput, { addressId: string }> = {
  id: 'customers.addresses.create',
  async execute(rawInput, ctx) {
    const parsed = addressCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, { tenantId: parsed.tenantId, organizationId: parsed.organizationId }, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const address = em.create(CustomerAddress, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      entity,
      name: parsed.name ?? null,
      purpose: parsed.purpose ?? null,
      companyName: parsed.companyName ?? null,
      addressLine1: parsed.addressLine1,
      addressLine2: parsed.addressLine2 ?? null,
      buildingNumber: parsed.buildingNumber ?? null,
      flatNumber: parsed.flatNumber ?? null,
      city: parsed.city ?? null,
      region: parsed.region ?? null,
      postalCode: parsed.postalCode ?? null,
      country: parsed.country ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      isPrimary: parsed.isPrimary ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await withAtomicFlush(em, [
      async () => {
        em.persist(address)
        await em.flush()
        if (address.isPrimary) {
          await enforcePrimaryAddress(em, entity.id, address.id)
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: address,
      identifiers: {
        id: address.id,
        organizationId: address.organizationId,
        tenantId: address.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })

    return { addressId: address.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId, snapshotScopeFromContext(ctx))
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as AddressSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.addresses.create', 'Create address'),
      resourceKind: 'customers.address',
      resourceId: result.addressId,
      parentResourceKind: resolveParentResourceKind(snapshot?.entityKind),
      parentResourceId: snapshot?.entityId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies AddressUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AddressUndoPayload>(logEntry)
    const after = payload?.after ?? null
    // Prefer the snapshot's own id, as the staff twin does — a log entry with no
    // `resourceId` used to make this undo a silent no-op.
    const addressId = after?.id ?? logEntry?.resourceId ?? null
    if (!addressId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(CustomerAddress, scopedAddressWhere(addressId, snapshotScopeFromSnapshot(after)))
    if (address) {
      em.remove(address)
      await em.flush()
    }
  },
  redo: async ({ logEntry, ctx }) => {
    const after = resolveRedoSnapshot<AddressSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for address create' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, after.entityId, { tenantId: after.tenantId, organizationId: after.organizationId }, undefined, 'Customer not found')
    let address = await findOneWithDecryption(
      em,
      CustomerAddress,
      { id: after.id },
      undefined,
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (!address) {
      address = em.create(CustomerAddress, {
        id: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        entity,
        ...readPostalAddressFields(after),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(address)
    } else {
      address.entity = entity
      assignPostalAddressFields(address, after)
    }
    const restoredAddress = address
    await withAtomicFlush(em, [
      async () => {
        em.persist(restoredAddress)
        await em.flush()
        if (after.isPrimary) {
          await enforcePrimaryAddress(em, after.entityId, after.id)
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restoredAddress,
      identifiers: {
        id: restoredAddress.id,
        organizationId: restoredAddress.organizationId,
        tenantId: restoredAddress.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })

    return { addressId: restoredAddress.id }
  },
}

const updateAddressCommand: CommandHandler<AddressUpdateInput, { addressId: string }> = {
  id: 'customers.addresses.update',
  async prepare(rawInput, ctx) {
    const parsed = addressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAddressSnapshot(em, parsed.id, snapshotScopeFromContext(ctx))
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = addressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(CustomerAddress, { id: parsed.id })
    if (!address) throw notFound('Address not found')
    ensureTenantScope(ctx, address.tenantId)
    ensureOrganizationScope(ctx, address.organizationId)

    if (parsed.entityId !== undefined) {
      const entity = await requireCustomerEntity(em, parsed.entityId, { tenantId: address.tenantId, organizationId: address.organizationId }, undefined, 'Customer not found')
      ensureSameScope(entity, address.organizationId, address.tenantId)
      address.entity = entity
    }

    await withAtomicFlush(em, [
      () => {
        applyPostalAddressPatch(address, parsed)
      },
      async () => {
        if (address.isPrimary) {
          await enforcePrimaryAddress(em, typeof address.entity === 'string' ? address.entity : address.entity.id, address.id)
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: address,
      identifiers: {
        id: address.id,
        organizationId: address.organizationId,
        tenantId: address.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })

    return { addressId: address.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId, snapshotScopeFromContext(ctx))
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as AddressSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as AddressSnapshot | undefined
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            [
              'entityId',
              'name',
              'purpose',
              'companyName',
              'addressLine1',
              'addressLine2',
              'buildingNumber',
              'flatNumber',
              'city',
              'region',
              'postalCode',
              'country',
              'latitude',
              'longitude',
              'isPrimary',
            ]
          )
        : {}
    return {
      actionLabel: translate('customers.audit.addresses.update', 'Update address'),
      resourceKind: 'customers.address',
      resourceId: before.id,
      parentResourceKind: resolveParentResourceKind(before.entityKind),
      parentResourceId: before.entityId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies AddressUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AddressUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let address = await em.findOne(CustomerAddress, scopedAddressWhere(before.id, snapshotScopeFromSnapshot(before)))
    const entity = await requireCustomerEntity(em, before.entityId, { tenantId: before.tenantId, organizationId: before.organizationId }, undefined, 'Customer not found')
    if (!address) {
      address = em.create(CustomerAddress, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        entity,
        ...readPostalAddressFields(before),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(address)
    } else {
      address.entity = entity
      assignPostalAddressFields(address, before)
    }
    await withAtomicFlush(em, [
      async () => {
        em.persist(address)
        await em.flush()
        if (before.isPrimary) {
          await enforcePrimaryAddress(em, before.entityId, before.id)
        }
      },
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: address,
      identifiers: {
        id: address.id,
        organizationId: address.organizationId,
        tenantId: address.tenantId,
      },
      indexer: addressCrudIndexer,
      events: addressCrudEvents,
    })
  },
}

const deleteAddressCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { addressId: string }> =
  {
    id: 'customers.addresses.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadAddressSnapshot(em, id, snapshotScopeFromContext(ctx))
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const address = await em.findOne(CustomerAddress, { id })
      if (!address) throw notFound('Address not found')
      ensureTenantScope(ctx, address.tenantId)
      ensureOrganizationScope(ctx, address.organizationId)
      em.remove(address)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: address,
        identifiers: {
          id: address.id,
          organizationId: address.organizationId,
          tenantId: address.tenantId,
        },
        indexer: addressCrudIndexer,
        events: addressCrudEvents,
      })
      return { addressId: address.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as AddressSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.addresses.delete', 'Delete address'),
        resourceKind: 'customers.address',
        resourceId: before.id,
        parentResourceKind: resolveParentResourceKind(before.entityKind),
        parentResourceId: before.entityId ?? null,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies AddressUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<AddressUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const entity = await requireCustomerEntity(em, before.entityId, { tenantId: before.tenantId, organizationId: before.organizationId }, undefined, 'Customer not found')
      let address = await em.findOne(CustomerAddress, scopedAddressWhere(before.id, snapshotScopeFromSnapshot(before)))
      if (!address) {
        address = em.create(CustomerAddress, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          entity,
          ...readPostalAddressFields(before),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(address)
      } else {
        address.entity = entity
        assignPostalAddressFields(address, before)
      }
      await withAtomicFlush(em, [
        async () => {
          em.persist(address)
          await em.flush()
          if (before.isPrimary) {
            await enforcePrimaryAddress(em, before.entityId, before.id)
          }
        },
      ], { transaction: true })

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: address,
        identifiers: {
          id: address.id,
          organizationId: address.organizationId,
          tenantId: address.tenantId,
        },
        indexer: addressCrudIndexer,
        events: addressCrudEvents,
      })
    },
  }

registerCommand(createAddressCommand)
registerCommand(updateAddressCommand)
registerCommand(deleteAddressCommand)
