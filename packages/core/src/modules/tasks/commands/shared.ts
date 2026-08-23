import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import type { TasksScope } from '../lib/people'

export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

/** Every tasks command is scoped by tenant AND organization; this is the pair
 *  each one asserts against the caller's context before touching a row. */
export function scopeOf(input: { tenantId: string; organizationId: string }): TasksScope {
  return { tenantId: input.tenantId, organizationId: input.organizationId }
}

export function forkEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

export function readEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve('em') as EntityManager
}

type TasksEntityKey =
  | 'tasks_project'
  | 'tasks_task'
  | 'tasks_milestone'
  | 'tasks_task_comment'
  | 'tasks_project_doc'
  | 'tasks_label'

/**
 * Entity ids are generated from the entity class names. Reading them through
 * optional chaining keeps the module importable before `yarn generate` has run
 * for a fresh clone, which the CLI does on `predev`.
 */
export function tasksEntityId(key: TasksEntityKey): string {
  return ((E as Record<string, Record<string, string>>).tasks?.[key]) ?? `tasks:${key}`
}

export function tasksIndexer(key: TasksEntityKey): CrudIndexerConfig<unknown> {
  return { entityType: tasksEntityId(key) }
}

export function tasksEvents(entity: string): CrudEventsConfig {
  return {
    module: 'tasks',
    entity,
    persistent: true,
    buildPayload: (ctx) => ({
      id: ctx.identifiers.id,
      organizationId: ctx.identifiers.organizationId,
      tenantId: ctx.identifiers.tenantId,
    }),
  }
}

export const projectIndexer = tasksIndexer('tasks_project')
export const projectEvents = tasksEvents('project')
export const taskIndexer = tasksIndexer('tasks_task')
export const taskEvents = tasksEvents('task')
export const milestoneIndexer = tasksIndexer('tasks_milestone')
export const milestoneEvents = tasksEvents('milestone')
export const commentIndexer = tasksIndexer('tasks_task_comment')
export const commentEvents = tasksEvents('comment')
export const docIndexer = tasksIndexer('tasks_project_doc')
export const docEvents = tasksEvents('doc')
export const labelIndexer = tasksIndexer('tasks_label')
export const labelEvents = tasksEvents('label')

export function todayUtcDate(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
}
