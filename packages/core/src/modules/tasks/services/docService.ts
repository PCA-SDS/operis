import type { EntityManager } from '@mikro-orm/postgresql'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { TasksProjectDoc } from '../data/entities'
import type { ProjectDocDto, ProjectDocTreeItemDto } from '../data/types'
import { isoInstant } from '../lib/values'
import { loadPeopleByIds, toTaskUser, type TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'

export interface DocService {
  tree(em: EntityManager, scope: TasksScope, projectId: string): Promise<ProjectDocTreeItemDto[]>
  getDetail(em: EntityManager, scope: TasksScope, id: string): Promise<ProjectDocDto>
  requireDoc(em: EntityManager, scope: TasksScope, id: string): Promise<TasksProjectDoc>
}

export class DefaultDocService implements DocService {
  /** Titles and hierarchy only — the sidebar renders the whole tree, and doc
   *  bodies are large enough that shipping them all would dominate the payload. */
  async tree(
    em: EntityManager,
    scope: TasksScope,
    projectId: string,
  ): Promise<ProjectDocTreeItemDto[]> {
    const rows = await em.find(
      TasksProjectDoc,
      {
        projectId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] as never },
    )
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId ?? null,
      title: row.title,
      position: row.position,
    }))
  }

  async requireDoc(em: EntityManager, scope: TasksScope, id: string): Promise<TasksProjectDoc> {
    const messages = await loadTasksMessages()
    return assertFound(
      await em.findOne(TasksProjectDoc, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.docNotFound,
    )
  }

  async getDetail(em: EntityManager, scope: TasksScope, id: string): Promise<ProjectDocDto> {
    const doc = await this.requireDoc(em, scope, id)
    const people = await loadPeopleByIds(em, scope, doc.authorUserId ? [doc.authorUserId] : [])
    return toDocDto(doc, people)
  }
}

export function toDocDto(
  doc: TasksProjectDoc,
  people: Map<string, { id: string; name: string; email: string }>,
): ProjectDocDto {
  return {
    id: doc.id,
    projectId: doc.projectId,
    parentId: doc.parentId ?? null,
    title: doc.title,
    body: doc.body,
    plaintext: doc.bodyPlaintext,
    position: doc.position,
    author: toTaskUser(doc.authorUserId ? people.get(doc.authorUserId) : null),
    createdAt: isoInstant(doc.createdAt) ?? '',
    updatedAt: isoInstant(doc.updatedAt ?? doc.createdAt) ?? '',
  }
}
