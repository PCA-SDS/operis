import type { EntityManager } from '@mikro-orm/postgresql'
import { assertFound, badRequest } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { TasksProject } from '../data/entities'
import {
  INBOX_PROJECT_ICON,
  INBOX_PROJECT_KEY,
  type AssignableUserDto,
  type PagedResponse,
  type ProjectDetailDto,
  type ProjectListItemDto,
  type TaskAssignmentOptionsDto,
} from '../data/types'
import type { ProjectListQuery } from '../data/validators'
import {
  buildProjectHydrationContext,
  toProjectDetailDto,
  toProjectListItemDto,
} from '../lib/projectReadModel'
import { listTenantRoles, listScopedUsers, toAssignableUser, type TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'

const INBOX_KEY_CANDIDATES = [INBOX_PROJECT_KEY, ...[2, 3, 4, 5].map((n) => `${INBOX_PROJECT_KEY}${n}`)]

export interface ProjectService {
  list(em: EntityManager, scope: TasksScope, query: ProjectListQuery): Promise<PagedResponse<ProjectListItemDto>>
  getDetail(em: EntityManager, scope: TasksScope, id: string): Promise<ProjectDetailDto>
  requireProject(em: EntityManager, scope: TasksScope, id: string): Promise<TasksProject>
  ensureInbox(em: EntityManager, scope: TasksScope): Promise<ProjectDetailDto>
  assignableUsers(em: EntityManager, scope: TasksScope): Promise<AssignableUserDto[]>
  assignmentOptions(em: EntityManager, scope: TasksScope): Promise<TaskAssignmentOptionsDto>
}

export class DefaultProjectService implements ProjectService {
  async list(
    em: EntityManager,
    scope: TasksScope,
    query: ProjectListQuery,
  ): Promise<PagedResponse<ProjectListItemDto>> {
    const filters: Record<string, unknown>[] = [
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
        // The Inbox is a storage location, not a project people plan in.
        isInbox: false,
      },
    ]
    if (query.archived === 'active') filters.push({ archivedAt: null })
    else if (query.archived === 'archived') filters.push({ archivedAt: { $ne: null } })
    if (query.ownerId) filters.push({ ownerUserId: query.ownerId })
    if (query.search?.trim()) {
      const pattern = `%${escapeLikePattern(query.search.trim())}%`
      filters.push({ $or: [{ name: { $ilike: pattern } }, { key: { $ilike: pattern } }] })
    }

    const where = { $and: filters } as never
    const orderBy =
      query.sort === 'name'
        ? [{ name: query.order }, { id: 'desc' as const }]
        : [{ createdAt: query.order }, { id: 'desc' as const }]

    const [rows, total] = await em.findAndCount(TasksProject, where, {
      orderBy: orderBy as never,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })

    const ctx = await buildProjectHydrationContext(em, scope, rows)
    return {
      items: rows.map((project) => toProjectListItemDto(project, ctx)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  async requireProject(em: EntityManager, scope: TasksScope, id: string): Promise<TasksProject> {
    const messages = await loadTasksMessages()
    return assertFound(
      await em.findOne(TasksProject, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.projectNotFound,
    )
  }

  async getDetail(em: EntityManager, scope: TasksScope, id: string): Promise<ProjectDetailDto> {
    const project = await this.requireProject(em, scope, id)
    const ctx = await buildProjectHydrationContext(em, scope, [project])
    return toProjectDetailDto(project, ctx)
  }

  /**
   * The scope's single hidden Inbox, created on first use. Two concurrent
   * callers can race here, so a unique-constraint failure re-reads rather than
   * bubbling: whoever lost the race still gets the winner's row.
   */
  async ensureInbox(em: EntityManager, scope: TasksScope): Promise<ProjectDetailDto> {
    const existing = await em.findOne(TasksProject, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isInbox: true,
      deletedAt: null,
    })
    if (existing) return this.getDetail(em, scope, existing.id)

    const messages = await loadTasksMessages()
    for (const key of INBOX_KEY_CANDIDATES) {
      const fork = em.fork()
      try {
        const project = fork.create(TasksProject, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          key,
          name: messages.inboxName,
          icon: INBOX_PROJECT_ICON,
          isInbox: true,
          startDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
          taskSeq: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        fork.persist(project)
        await fork.flush()
        return this.getDetail(em, scope, project.id)
      } catch {
        const winner = await em.findOne(TasksProject, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          isInbox: true,
          deletedAt: null,
        })
        if (winner) return this.getDetail(em, scope, winner.id)
      }
    }
    throw badRequest(messages.inboxKeysTaken)
  }

  async assignableUsers(em: EntityManager, scope: TasksScope): Promise<AssignableUserDto[]> {
    const people = await listScopedUsers(em, scope)
    return people.map(toAssignableUser)
  }

  async assignmentOptions(em: EntityManager, scope: TasksScope): Promise<TaskAssignmentOptionsDto> {
    return { roles: await listTenantRoles(em, scope) }
  }
}
