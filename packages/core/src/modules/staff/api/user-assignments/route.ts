import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTeamMember, StaffTeamRole } from '../../data/entities'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('staff').child({ component: 'user-assignments' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
}

const querySchema = z.object({
  userId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  organizationIds: z.string().min(1),
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseOrganizationIds(raw: string): string[] {
  return Array.from(new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => UUID_PATTERN.test(value)),
  ))
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.sub) throw new CrudHttpError(401, { error: 'Unauthorized' })

    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const tenantId = query.tenantId ?? auth.tenantId
    if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant is required' })
    if (tenantId !== auth.tenantId && auth.isSuperAdmin !== true) {
      throw new CrudHttpError(403, { error: 'Tenant is outside actor scope' })
    }
    const organizationIds = parseOrganizationIds(query.organizationIds)
    if (!organizationIds.length) return NextResponse.json({ items: [] })

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const isSuperAdmin = auth.isSuperAdmin === true
    if (!isSuperAdmin && scope.allowedIds && organizationIds.some((id) => !scope.allowedIds?.includes(id))) {
      throw new CrudHttpError(403, { error: 'Organization is outside actor scope' })
    }

    if (query.userId) {
      const user = await findOneWithDecryption(
        em,
        User,
        { id: query.userId, tenantId, deletedAt: null },
        undefined,
        { tenantId, organizationId: null },
      )
      if (!user) throw new CrudHttpError(404, { error: 'User not found' })
    }

    const [roles, members] = await Promise.all([
      findWithDecryption(
        em,
        StaffTeamRole,
        { tenantId, organizationId: { $in: organizationIds }, deletedAt: null },
        { orderBy: { name: 'asc' } },
        { tenantId, organizationId: null },
      ),
      query.userId
        ? findWithDecryption(
            em,
            StaffTeamMember,
            {
              tenantId,
              organizationId: { $in: organizationIds },
              userId: query.userId,
              deletedAt: null,
            },
            { orderBy: { updatedAt: 'desc' } },
            { tenantId, organizationId: null },
          )
        : Promise.resolve([] as StaffTeamMember[]),
    ])

    const rolesByOrganization = new Map<string, StaffTeamRole[]>()
    for (const role of roles) {
      const list = rolesByOrganization.get(String(role.organizationId)) ?? []
      list.push(role)
      rolesByOrganization.set(String(role.organizationId), list)
    }
    const membersByOrganization = new Map<string, StaffTeamMember>()
    for (const member of members) {
      if (!membersByOrganization.has(String(member.organizationId))) {
        membersByOrganization.set(String(member.organizationId), member)
      }
    }

    return NextResponse.json({
      items: organizationIds.map((organizationId) => {
        const member = membersByOrganization.get(organizationId)
        return {
          organizationId,
          memberId: member?.id ?? null,
          roleIds: Array.isArray(member?.roleIds) ? member.roleIds : [],
          roles: (rolesByOrganization.get(organizationId) ?? []).map((role) => ({
            id: role.id,
            name: role.name,
          })),
        }
      }),
    })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
    logger.error('staff.userAssignments.load failed', { error })
    return NextResponse.json({ error: 'Unable to load staff assignments' }, { status: 500 })
  }
}

export const openApi = {
  summary: 'Load staff roles and assignments for a user across organizations',
  responses: {
    200: { description: 'Staff role assignments loaded' },
  },
}
