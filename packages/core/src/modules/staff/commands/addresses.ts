import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMemberAddress } from '../data/entities'
import {
  staffTeamMemberAddressCreateSchema,
  staffTeamMemberAddressUpdateSchema,
  type StaffTeamMemberAddressCreateInput,
  type StaffTeamMemberAddressUpdateInput,
} from '../data/validators'
import { staffTeamMemberAddressCrudEvents } from '../lib/crud'
import {
  applyScopeToWhere,
  commandActorScope,
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  explicitStaffCommandScope,
  extractUndoPayload,
  requireTeamMember,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffSnapshotScope,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { assignPostalAddressFields, readPostalAddressFields, applyPostalAddressPatch } from '@open-mercato/shared/lib/location/postalAddress'

const addressCrudIndexer: CrudIndexerConfig<StaffTeamMemberAddress> = {
  entityType: E.staff.staff_team_member_address,
}

type AddressSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  memberId: string
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

async function loadAddressSnapshot(em: EntityManager, id: string, scope?: StaffSnapshotScope | null): Promise<AddressSnapshot | null> {
  const address = await em.findOne(StaffTeamMemberAddress, scopedStaffSnapshotWhere(id, scope))
  if (!address) return null
  return {
    id: address.id,
    organizationId: address.organizationId,
    tenantId: address.tenantId,
    memberId: typeof address.member === 'string' ? address.member : address.member.id,
    ...readPostalAddressFields(address),
  }
}

async function enforcePrimaryAddress(em: EntityManager, memberId: string, addressId: string): Promise<void> {
  await em.nativeUpdate(
    StaffTeamMemberAddress,
    { member: memberId, id: { $ne: addressId }, isPrimary: true },
    { isPrimary: false }
  )
}

const createAddressCommand: CommandHandler<StaffTeamMemberAddressCreateInput, { addressId: string }> = {
  id: 'staff.team-member-addresses.create',
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberAddressCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await requireTeamMember(
      em,
      parsed.entityId,
      scope,
      'Team member not found',
    )
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    const address = em.create(StaffTeamMemberAddress, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      member,
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
    em.persist(address)
    await withAtomicFlush(em, [
      async () => {
        await em.flush()
        if (address.isPrimary) {
          await enforcePrimaryAddress(em, member.id, address.id)
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
      events: staffTeamMemberAddressCrudEvents,
      indexer: addressCrudIndexer,
    })

    return { addressId: address.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId, staffSnapshotScopeFromContext(ctx))
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as AddressSnapshot | undefined
    return {
      actionLabel: translate('staff.audit.teamMemberAddresses.create', 'Create address'),
      resourceKind: 'staff.team_member_address',
      resourceId: result.addressId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: snapshot?.memberId ?? null,
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
    const after = payload?.after
    const addressId = after?.id ?? logEntry?.resourceId ?? null
    if (!addressId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(StaffTeamMemberAddress, scopedStaffSnapshotWhere(addressId, staffSnapshotScopeFromSnapshot(after)))
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
    const snapshotScope = staffSnapshotScopeFromSnapshot(after)
    const member = await requireTeamMember(
      em,
      after.memberId,
      explicitStaffCommandScope(after.tenantId, after.organizationId),
      'Team member not found',
    )
    let address = await em.findOne(StaffTeamMemberAddress, scopedStaffSnapshotWhere(after.id, snapshotScope))
    if (!address) {
      address = em.create(StaffTeamMemberAddress, {
        id: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        member,
        ...readPostalAddressFields(after),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(address)
    } else {
      address.member = member
      assignPostalAddressFields(address, after)
    }
    await withAtomicFlush(em, [
      async () => {
        await em.flush()
        if (after.isPrimary) {
          await enforcePrimaryAddress(em, after.memberId, after.id)
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
      events: staffTeamMemberAddressCrudEvents,
      indexer: addressCrudIndexer,
    })

    return { addressId: address.id }
  },
}

const updateAddressCommand: CommandHandler<StaffTeamMemberAddressUpdateInput, { addressId: string }> = {
  id: 'staff.team-member-addresses.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTeamMemberAddressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAddressSnapshot(em, parsed.id, staffSnapshotScopeFromContext(ctx))
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberAddressUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = commandActorScope(ctx)
    const address = await em.findOne(
      StaffTeamMemberAddress,
      applyScopeToWhere<StaffTeamMemberAddress>({ id: parsed.id }, scope),
    )
    if (!address) throw new CrudHttpError(404, { error: 'Address not found' })
    ensureTenantScope(ctx, address.tenantId)
    ensureOrganizationScope(ctx, address.organizationId)

    if (parsed.entityId !== undefined) {
      const member = await requireTeamMember(em, parsed.entityId, scope, 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      address.member = member
    }
    applyPostalAddressPatch(address, parsed)

    await withAtomicFlush(em, [
      async () => {
        await em.flush()
        if (address.isPrimary) {
          await enforcePrimaryAddress(em, typeof address.member === 'string' ? address.member : address.member.id, address.id)
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
      events: staffTeamMemberAddressCrudEvents,
      indexer: addressCrudIndexer,
    })

    return { addressId: address.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadAddressSnapshot(em, result.addressId, staffSnapshotScopeFromContext(ctx))
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
              'memberId',
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
            ],
          )
        : {}
    return {
      actionLabel: translate('staff.audit.teamMemberAddresses.update', 'Update address'),
      resourceKind: 'staff.team_member_address',
      resourceId: before.id,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: before.memberId ?? null,
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
    const snapshotScope = staffSnapshotScopeFromSnapshot(before)
    let address = await em.findOne(StaffTeamMemberAddress, scopedStaffSnapshotWhere(before.id, snapshotScope))
    const member = await requireTeamMember(
      em,
      before.memberId,
      explicitStaffCommandScope(before.tenantId, before.organizationId),
      'Team member not found',
    )

    if (!address) {
      address = em.create(StaffTeamMemberAddress, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        member,
        ...readPostalAddressFields(before),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(address)
    } else {
      address.member = member
      assignPostalAddressFields(address, before)
    }
    await withAtomicFlush(em, [
      async () => {
        await em.flush()
        if (before.isPrimary) {
          await enforcePrimaryAddress(em, before.memberId, before.id)
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
      events: staffTeamMemberAddressCrudEvents,
      indexer: addressCrudIndexer,
    })
  },
}

const deleteAddressCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { addressId: string }> =
  {
    id: 'staff.team-member-addresses.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadAddressSnapshot(em, id, staffSnapshotScopeFromContext(ctx))
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Address id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const scope = commandActorScope(ctx)
      const address = await em.findOne(
        StaffTeamMemberAddress,
        applyScopeToWhere<StaffTeamMemberAddress>({ id }, scope),
      )
      if (!address) throw new CrudHttpError(404, { error: 'Address not found' })
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
        events: staffTeamMemberAddressCrudEvents,
      indexer: addressCrudIndexer,
      })
      return { addressId: address.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as AddressSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('staff.audit.teamMemberAddresses.delete', 'Delete address'),
        resourceKind: 'staff.team_member_address',
        resourceId: before.id,
        parentResourceKind: 'staff.teamMember',
        parentResourceId: before.memberId ?? null,
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
      const snapshotScope = staffSnapshotScopeFromSnapshot(before)
      const member = await requireTeamMember(
        em,
        before.memberId,
        explicitStaffCommandScope(before.tenantId, before.organizationId),
        'Team member not found',
      )
      let address = await em.findOne(StaffTeamMemberAddress, scopedStaffSnapshotWhere(before.id, snapshotScope))
      if (!address) {
        address = em.create(StaffTeamMemberAddress, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          member,
          ...readPostalAddressFields(before),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(address)
      } else {
        address.member = member
        assignPostalAddressFields(address, before)
      }
      await withAtomicFlush(em, [
        async () => {
          await em.flush()
          if (before.isPrimary) {
            await enforcePrimaryAddress(em, before.memberId, before.id)
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
        events: staffTeamMemberAddressCrudEvents,
      indexer: addressCrudIndexer,
      })
    },
  }

registerCommand(createAddressCommand)
registerCommand(updateAddressCommand)
registerCommand(deleteAddressCommand)
