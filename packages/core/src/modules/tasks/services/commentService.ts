import type { EntityManager } from '@mikro-orm/postgresql'
import { assertFound } from '@open-mercato/shared/lib/crud/errors'
import { TasksTaskComment } from '../data/entities'
import type { PagedResponse, TaskCommentDto } from '../data/types'
import { isoInstant } from '../lib/values'
import { loadPeopleByIds, toTaskUser, type PersonRow, type TasksScope } from '../lib/people'
import { loadTasksMessages } from '../lib/messages'

/** An edit is only worth flagging when it happened meaningfully after the post;
 *  the same-transaction `updated_at` write is not an edit. */
const EDIT_THRESHOLD_MS = 1000

export interface CommentService {
  list(
    em: EntityManager,
    scope: TasksScope,
    taskId: string,
    query: { page: number; pageSize: number },
  ): Promise<PagedResponse<TaskCommentDto>>
  requireComment(em: EntityManager, scope: TasksScope, id: string): Promise<TasksTaskComment>
}

export class DefaultCommentService implements CommentService {
  async list(
    em: EntityManager,
    scope: TasksScope,
    taskId: string,
    query: { page: number; pageSize: number },
  ): Promise<PagedResponse<TaskCommentDto>> {
    const [rows, total] = await em.findAndCount(
      TasksTaskComment,
      {
        taskId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] as never,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      },
    )
    const people = await loadPeopleByIds(
      em,
      scope,
      rows.map((row) => row.authorUserId).filter((id): id is string => !!id),
    )
    return {
      items: rows.map((row) => toCommentDto(row, people)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  async requireComment(
    em: EntityManager,
    scope: TasksScope,
    id: string,
  ): Promise<TasksTaskComment> {
    const messages = await loadTasksMessages()
    return assertFound(
      await em.findOne(TasksTaskComment, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      messages.commentNotFound,
    )
  }
}

export function toCommentDto(
  comment: TasksTaskComment,
  people: Map<string, PersonRow>,
): TaskCommentDto {
  const createdAt = comment.createdAt
  const updatedAt = comment.updatedAt ?? comment.createdAt
  return {
    id: comment.id,
    taskId: comment.taskId,
    body: comment.body,
    plaintext: comment.bodyPlaintext,
    author: toTaskUser(comment.authorUserId ? people.get(comment.authorUserId) : null),
    createdAt: isoInstant(createdAt) ?? '',
    updatedAt: isoInstant(updatedAt) ?? '',
    isEdited: updatedAt.getTime() - createdAt.getTime() > EDIT_THRESHOLD_MS,
  }
}
