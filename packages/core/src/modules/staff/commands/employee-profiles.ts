import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StaffEmployeeProfile, type StaffEmploymentType } from '../data/entities'
import {
  staffEmployeeProfileCreateSchema,
  staffEmployeeProfileUpdateSchema,
  type StaffEmployeeProfileCreateInput,
  type StaffEmployeeProfileUpdateInput,
} from '../data/validators'
import { staffEmployeeProfileCrudEvents } from '../lib/crud'
import {
  commandInputScope,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireTeamMember,
  scopedStaffSnapshotWhere,
  staffSnapshotScopeFromContext,
  staffSnapshotScopeFromSnapshot,
  type StaffSnapshotScope,
} from './shared'
import { E } from '#generated/entities.ids.generated'

const profileCrudIndexer: CrudIndexerConfig<StaffEmployeeProfile> = {
  entityType: E.staff.staff_employee_profile,
}

type ProfileSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  memberId: string
  employeeNumber: string | null
  jobTitle: string | null
  employmentType: StaffEmploymentType | null
  startDate: string | null
  endDate: string | null
  workPhone: string | null
  personalPhone: string | null
  personalEmail: string | null
  dateOfBirth: string | null
  notes: string | null
}

type ProfileUndoPayload = {
  before?: ProfileSnapshot | null
  after?: ProfileSnapshot | null
}

async function loadProfileSnapshot(
  em: EntityManager,
  id: string,
  scope?: StaffSnapshotScope | null,
): Promise<ProfileSnapshot | null> {
  const profile = await em.findOne(StaffEmployeeProfile, scopedStaffSnapshotWhere(id, scope), { populate: ['member'] })
  if (!profile) return null
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    tenantId: profile.tenantId,
    memberId: profile.member.id,
    employeeNumber: profile.employeeNumber ?? null,
    jobTitle: profile.jobTitle ?? null,
    employmentType: profile.employmentType ?? null,
    startDate: profile.startDate ?? null,
    endDate: profile.endDate ?? null,
    workPhone: profile.workPhone ?? null,
    personalPhone: profile.personalPhone ?? null,
    personalEmail: profile.personalEmail ?? null,
    dateOfBirth: profile.dateOfBirth ?? null,
    notes: profile.notes ?? null,
  }
}

/** Fields the caller may set, in one place so create and update cannot drift. */
function applyProfileFields(
  profile: StaffEmployeeProfile,
  input: Partial<StaffEmployeeProfileCreateInput>,
): void {
  if (input.employeeNumber !== undefined) profile.employeeNumber = input.employeeNumber ?? null
  if (input.jobTitle !== undefined) profile.jobTitle = input.jobTitle ?? null
  if (input.employmentType !== undefined) profile.employmentType = input.employmentType ?? null
  if (input.startDate !== undefined) profile.startDate = input.startDate ?? null
  if (input.endDate !== undefined) profile.endDate = input.endDate ?? null
  if (input.workPhone !== undefined) profile.workPhone = input.workPhone ?? null
  if (input.personalPhone !== undefined) profile.personalPhone = input.personalPhone ?? null
  if (input.personalEmail !== undefined) profile.personalEmail = input.personalEmail ?? null
  if (input.dateOfBirth !== undefined) profile.dateOfBirth = input.dateOfBirth ?? null
  if (input.notes !== undefined) profile.notes = input.notes ?? null
}

const createProfileCommand: CommandHandler<StaffEmployeeProfileCreateInput, { profileId: string }> = {
  id: 'staff.employee-profiles.create',
  async execute(rawInput, ctx) {
    const parsed = staffEmployeeProfileCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = commandInputScope(ctx, parsed.tenantId, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await requireTeamMember(em, parsed.memberId, scope, 'Team member not found')
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    const profile = em.create(StaffEmployeeProfile, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      member,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    applyProfileFields(profile, parsed)
    em.persist(profile)
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: profile,
      identifiers: { id: profile.id, organizationId: profile.organizationId, tenantId: profile.tenantId },
      events: staffEmployeeProfileCrudEvents,
      indexer: profileCrudIndexer,
    })

    return { profileId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadProfileSnapshot(em, result.profileId, staffSnapshotScopeFromContext(ctx))
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as ProfileSnapshot | undefined
    return {
      actionLabel: translate('staff.audit.employeeProfiles.create', 'Create HR profile'),
      resourceKind: 'staff.employee_profile',
      resourceId: result.profileId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: snapshot?.memberId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: { undo: { after: snapshot ?? null } satisfies ProfileUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProfileUndoPayload>(logEntry)
    const after = payload?.after
    const profileId = after?.id ?? logEntry?.resourceId ?? null
    if (!profileId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(
      StaffEmployeeProfile,
      scopedStaffSnapshotWhere(profileId, staffSnapshotScopeFromSnapshot(after)),
    )
    if (existing) {
      em.remove(existing)
      await em.flush()
    }
  },
}

const updateProfileCommand: CommandHandler<StaffEmployeeProfileUpdateInput, { profileId: string }> = {
  id: 'staff.employee-profiles.update',
  async prepare(rawInput, ctx) {
    const parsed = staffEmployeeProfileUpdateSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadProfileSnapshot(em, requireId(parsed.id), staffSnapshotScopeFromContext(ctx))
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffEmployeeProfileUpdateSchema.parse(rawInput)
    const id = requireId(parsed.id)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profile = await em.findOne(
      StaffEmployeeProfile,
      scopedStaffSnapshotWhere(id, staffSnapshotScopeFromContext(ctx)),
      { populate: ['member'] },
    )
    if (!profile) throw new Error('HR profile not found')
    ensureTenantScope(ctx, profile.tenantId)
    ensureOrganizationScope(ctx, profile.organizationId)

    applyProfileFields(profile, parsed)
    profile.updatedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: profile,
      identifiers: { id: profile.id, organizationId: profile.organizationId, tenantId: profile.tenantId },
      events: staffEmployeeProfileCrudEvents,
      indexer: profileCrudIndexer,
    })

    return { profileId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadProfileSnapshot(em, result.profileId, staffSnapshotScopeFromContext(ctx))
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ProfileSnapshot | undefined
    const after = snapshots.after as ProfileSnapshot | undefined
    return {
      actionLabel: translate('staff.audit.employeeProfiles.update', 'Update HR profile'),
      resourceKind: 'staff.employee_profile',
      resourceId: result.profileId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: after?.memberId ?? before?.memberId ?? null,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: { undo: { before: before ?? null, after: after ?? null } satisfies ProfileUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProfileUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profile = await em.findOne(
      StaffEmployeeProfile,
      scopedStaffSnapshotWhere(before.id, staffSnapshotScopeFromSnapshot(before)),
    )
    if (!profile) return
    applyProfileFields(profile, {
      employeeNumber: before.employeeNumber,
      jobTitle: before.jobTitle,
      employmentType: before.employmentType,
      startDate: before.startDate,
      endDate: before.endDate,
      workPhone: before.workPhone,
      personalPhone: before.personalPhone,
      personalEmail: before.personalEmail,
      dateOfBirth: before.dateOfBirth,
      notes: before.notes,
    })
    profile.updatedAt = new Date()
    await em.flush()
  },
}

const deleteProfileCommand: CommandHandler<{ id: string }, { profileId: string }> = {
  id: 'staff.employee-profiles.delete',
  async prepare(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string })?.id)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadProfileSnapshot(em, id, staffSnapshotScopeFromContext(ctx))
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const id = requireId((rawInput as { id?: string })?.id)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profile = await em.findOne(
      StaffEmployeeProfile,
      scopedStaffSnapshotWhere(id, staffSnapshotScopeFromContext(ctx)),
    )
    if (!profile) throw new Error('HR profile not found')
    ensureTenantScope(ctx, profile.tenantId)
    ensureOrganizationScope(ctx, profile.organizationId)

    // Soft delete, so the partial unique index frees the member for a new record.
    profile.deletedAt = new Date()
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: profile,
      identifiers: { id: profile.id, organizationId: profile.organizationId, tenantId: profile.tenantId },
      events: staffEmployeeProfileCrudEvents,
      indexer: profileCrudIndexer,
    })

    return { profileId: profile.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as ProfileSnapshot | undefined
    return {
      actionLabel: translate('staff.audit.employeeProfiles.delete', 'Delete HR profile'),
      resourceKind: 'staff.employee_profile',
      resourceId: result.profileId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: before?.memberId ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before: before ?? null } satisfies ProfileUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProfileUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profile = await em.findOne(StaffEmployeeProfile, { id: before.id })
    if (!profile) return
    profile.deletedAt = null
    profile.updatedAt = new Date()
    await em.flush()
  },
}

registerCommand(createProfileCommand)
registerCommand(updateProfileCommand)
registerCommand(deleteProfileCommand)
