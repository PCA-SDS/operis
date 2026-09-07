import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ScopedAttachmentUploadService } from '@open-mercato/core/modules/attachments/lib/scoped-upload-service'
import { E } from '#generated/entities.ids.generated'
import { StaffEmployeeProfile, StaffTeam, StaffTeamMember, StaffTeamRole } from '../../data/entities'
import {
  employeeRecordFileName,
  renderEmployeeRecordMarkdown,
  type EmployeeRecordLabels,
  type EmployeeRecordSnapshot,
} from '../../lib/employeeRecord'

/**
 * Generates a member's HR record and files it as an attachment.
 *
 * Markdown, stored through the attachments module — the reference writes a PDF
 * into Nextcloud, neither of which Operis has. Regenerating simply files a new
 * version alongside the last, so the record is a point-in-time document rather
 * than something that silently rewrites itself.
 *
 * Gated by `staff.hr_profile.manage`: the document contains everything the HR
 * profile does, so producing one must need the same right as reading it.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.hr_profile.manage'] },
}

const bodySchema = z.object({ memberId: z.string().uuid() })

const responseSchema = z.object({
  attachmentId: z.string(),
  fileName: z.string(),
})

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: translate('staff.errors.invalidInput', 'Invalid input.') })
    }

    const em = container.resolve('em') as EntityManager
    const member = await em.findOne(StaffTeamMember, {
      id: parsed.data.memberId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!member) {
      throw new CrudHttpError(404, { error: translate('staff.errors.memberNotFound', 'Team member not found.') })
    }

    // The record writes HR data, so it goes through the same guard chain as any
    // other mutation on this member before anything is produced.
    const legacyGuard = bridgeLegacyGuard(container)
    const guardInput: MutationGuardInput = {
      operation: 'update',
      resourceKind: 'staff.teamMember',
      resourceId: member.id,
      tenantId,
      organizationId,
      userId: auth.sub ?? '',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      mutationPayload: parsed.data,
    }
    const guardResult = legacyGuard
      ? await runMutationGuards([legacyGuard], guardInput, { userFeatures: resolveUserFeatures(auth) })
      : { ok: true, afterSuccessCallbacks: [] as Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }> }
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? {}, { status: guardResult.errorStatus ?? 403 })
    }

    const [profile, team, roles] = await Promise.all([
      findOneWithDecryption(
        em,
        StaffEmployeeProfile,
        { member: member.id, tenantId, organizationId, deletedAt: null },
        undefined,
        { tenantId, organizationId },
      ),
      member.teamId
        ? em.findOne(StaffTeam, { id: member.teamId, tenantId, organizationId, deletedAt: null })
        : Promise.resolve(null),
      member.roleIds.length
        ? em.find(StaffTeamRole, { id: { $in: member.roleIds }, tenantId, organizationId, deletedAt: null })
        : Promise.resolve([]),
    ])

    const snapshot: EmployeeRecordSnapshot = {
      displayName: member.displayName,
      email: null,
      teamName: team?.name ?? null,
      roleNames: roles.map((role) => role.name),
      isActive: member.isActive,
      employeeNumber: profile?.employeeNumber ?? null,
      jobTitle: profile?.jobTitle ?? null,
      employmentType: profile?.employmentType ?? null,
      startDate: profile?.startDate ?? null,
      endDate: profile?.endDate ?? null,
      workPhone: profile?.workPhone ?? null,
      personalPhone: profile?.personalPhone ?? null,
      personalEmail: profile?.personalEmail ?? null,
      dateOfBirth: profile?.dateOfBirth ?? null,
      notes: profile?.notes ?? null,
    }

    const labels: EmployeeRecordLabels = {
      title: translate('staff.employeeRecord.title', 'Employee record'),
      sections: {
        identity: translate('staff.employeeRecord.sections.identity', 'Identity'),
        employment: translate('staff.employeeRecord.sections.employment', 'Employment'),
        contact: translate('staff.employeeRecord.sections.contact', 'Contact'),
        notes: translate('staff.employeeRecord.sections.notes', 'Notes'),
      },
      fields: {
        email: translate('staff.employeeRecord.fields.email', 'Email'),
        team: translate('staff.employeeRecord.fields.team', 'Team'),
        roles: translate('staff.employeeRecord.fields.roles', 'Roles'),
        status: translate('staff.employeeRecord.fields.status', 'Status'),
        employeeNumber: translate('staff.hrProfile.fields.employeeNumber', 'Employee number'),
        jobTitle: translate('staff.hrProfile.fields.jobTitle', 'Job title'),
        employmentType: translate('staff.hrProfile.fields.employmentType', 'Employment type'),
        startDate: translate('staff.hrProfile.fields.startDate', 'Start date'),
        endDate: translate('staff.hrProfile.fields.endDate', 'End date'),
        workPhone: translate('staff.hrProfile.fields.workPhone', 'Work phone'),
        personalPhone: translate('staff.hrProfile.fields.personalPhone', 'Personal phone'),
        personalEmail: translate('staff.hrProfile.fields.personalEmail', 'Personal email'),
        dateOfBirth: translate('staff.hrProfile.fields.dateOfBirth', 'Date of birth'),
        full_time: translate('staff.hrProfile.employmentTypes.full_time', 'Full time'),
        part_time: translate('staff.hrProfile.employmentTypes.part_time', 'Part time'),
        contract: translate('staff.hrProfile.employmentTypes.contract', 'Contract'),
        intern: translate('staff.hrProfile.employmentTypes.intern', 'Intern'),
        temporary: translate('staff.hrProfile.employmentTypes.temporary', 'Temporary'),
      },
      values: {
        active: translate('staff.employeeRecord.values.active', 'Active'),
        inactive: translate('staff.employeeRecord.values.inactive', 'Inactive'),
        none: translate('staff.employeeRecord.values.none', 'Nothing recorded'),
      },
    }

    const uploads = container.resolve('attachmentScopedUploadService') as ScopedAttachmentUploadService
    const attachment = await uploads.upload({
      tenantId,
      organizationId,
      entityId: E.staff.staff_team_member,
      recordId: member.id,
      fileName: employeeRecordFileName(snapshot),
      declaredMimeType: 'text/markdown',
      buffer: Buffer.from(renderEmployeeRecordMarkdown(snapshot, labels), 'utf8'),
      tags: ['employee-record'],
    })

    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        // `MutationGuardAfterInput` requires a concrete resourceId and takes
        // no payload, so it is built rather than spread from the guard input.
        await callback.guard.afterSuccess({
          tenantId,
          organizationId,
          userId: auth.sub ?? '',
          resourceKind: 'staff.teamMember',
          resourceId: member.id,
          operation: 'update',
          requestMethod: 'POST',
          requestHeaders: req.headers,
          metadata: callback.metadata ?? null,
        })
      } catch {
        // A committed write must still report success; the callback owns its
        // own logging.
      }
    }

    return NextResponse.json({ attachmentId: attachment.id, fileName: attachment.fileName })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Employee record',
  methods: {
    POST: {
      summary: 'Generate an employee record',
      description: "Renders a team member's HR record as Markdown and files it as an attachment.",
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'The stored record', schema: responseSchema }],
    },
  },
}
