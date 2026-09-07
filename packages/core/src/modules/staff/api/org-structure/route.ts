import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Role, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTeamMember } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.view'] },
}

const orgMemberSchema = z.object({
  memberId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  displayName: z.string(),
  isActive: z.boolean(),
})

const orgRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentRoleId: z.string().uuid().nullable(),
  members: z.array(orgMemberSchema),
})

const responseSchema = z.object({
  roles: z.array(orgRoleSchema),
  /** Members with no role, or whose only roles sit outside this tenant's tree. */
  unassigned: z.array(orgMemberSchema),
})

/**
 * The organisation chart: roles arranged by their reporting line, with the
 * team members who hold each one.
 *
 * The tree is a property of roles, not of people — a person is placed by the
 * role they hold. That is the reference's model, and it is why this reads
 * `roles.parent_role_id` rather than a manager field on the member.
 *
 * Read-only. Editing the tree is role administration and belongs to the auth
 * module's role pages, not here.
 */
export async function GET(req: Request) {
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

    const em = container.resolve('em') as EntityManager

    const [roles, members] = await Promise.all([
      em.find(Role, { tenantId, deletedAt: null }, { orderBy: { name: 'asc' } }),
      em.find(
        StaffTeamMember,
        { tenantId, organizationId, deletedAt: null },
        { orderBy: { displayName: 'asc' } },
      ),
    ])

    const memberUserIds = members
      .map((member) => member.userId)
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0)

    // One query for the whole join rather than one per member.
    const userRoles = memberUserIds.length
      ? await em.find(UserRole, { user: { $in: memberUserIds }, deletedAt: null }, { populate: ['role'] })
      : []

    const roleIdsByUser = new Map<string, string[]>()
    for (const link of userRoles) {
      const userId = link.user?.id
      const roleId = link.role?.id
      if (!userId || !roleId) continue
      const existing = roleIdsByUser.get(userId)
      if (existing) existing.push(roleId)
      else roleIdsByUser.set(userId, [roleId])
    }

    const knownRoleIds = new Set(roles.map((role) => role.id))
    const membersByRole = new Map<string, z.infer<typeof orgMemberSchema>[]>()
    const unassigned: z.infer<typeof orgMemberSchema>[] = []

    for (const member of members) {
      const entry = {
        memberId: member.id,
        userId: member.userId ?? null,
        displayName: member.displayName,
        isActive: member.isActive,
      }
      const held = (member.userId ? roleIdsByUser.get(member.userId) : undefined)?.filter((id) => knownRoleIds.has(id))
      if (!held || held.length === 0) {
        unassigned.push(entry)
        continue
      }
      // A person holding several roles appears under each — the chart shows
      // where they sit, and a dual-hatted person genuinely sits in two places.
      for (const roleId of held) {
        const bucket = membersByRole.get(roleId)
        if (bucket) bucket.push(entry)
        else membersByRole.set(roleId, [entry])
      }
    }

    return NextResponse.json({
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        parentRoleId: role.parentRoleId ?? null,
        members: membersByRole.get(role.id) ?? [],
      })),
      unassigned,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Organisation chart',
  methods: {
    GET: {
      summary: 'Organisation chart',
      description: 'Roles arranged by reporting line, with the team members holding each role.',
      responses: [{ status: 200, description: 'Organisation structure', schema: responseSchema }],
    },
  },
}
