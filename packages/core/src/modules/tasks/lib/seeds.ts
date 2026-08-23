import type { EntityManager } from '@mikro-orm/postgresql'
import { TasksMilestone, TasksProject, TasksTask } from '../data/entities'
import { RANK_STEP } from './rank'
import type { TasksScope } from './people'

const EXAMPLE_PROJECT_KEY = 'DEMO'

type ExampleTask = {
  title: string
  status: TasksTask['status']
  priority: TasksTask['priority']
  dueInDays?: number
  milestone?: boolean
}

const EXAMPLE_TASKS: ExampleTask[] = [
  { title: 'Draft the launch checklist', status: 'in_progress', priority: 'high', dueInDays: 2, milestone: true },
  { title: 'Collect feedback from the pilot team', status: 'pending', priority: 'medium', dueInDays: 5 },
  { title: 'Write the release notes', status: 'backlog', priority: 'low' },
  { title: 'Fix the onboarding redirect', status: 'review', priority: 'urgent', dueInDays: 1 },
  { title: 'Archive last quarter’s board', status: 'done', priority: 'none' },
]

function addDays(days: number): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

/** A demo project so a fresh tenant lands on a populated board instead of an
 *  empty state. Idempotent — running setup twice must not duplicate it. */
export async function seedExampleProject(em: EntityManager, scope: TasksScope): Promise<void> {
  const existing = await em.findOne(TasksProject, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: EXAMPLE_PROJECT_KEY,
  })
  if (existing) return

  const project = em.create(TasksProject, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: EXAMPLE_PROJECT_KEY,
    name: 'Demo project',
    description: 'A sample project showing how tasks, milestones and the board fit together.',
    icon: '🚀',
    startDate: addDays(0),
    isInbox: false,
    taskSeq: EXAMPLE_TASKS.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(project)
  await em.flush()

  const milestone = em.create(TasksMilestone, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    projectId: project.id,
    name: 'First release',
    description: 'Everything that has to land before the demo goes out.',
    status: 'active',
    dueDate: addDays(14),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(milestone)
  await em.flush()

  const rankByStatus = new Map<TasksTask['status'], number>()
  EXAMPLE_TASKS.forEach((example, index) => {
    const rank = (rankByStatus.get(example.status) ?? 0) + RANK_STEP
    rankByStatus.set(example.status, rank)
    em.persist(
      em.create(TasksTask, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        projectId: project.id,
        milestoneId: example.milestone ? milestone.id : null,
        number: index + 1,
        title: example.title,
        description: '',
        descriptionPlaintext: '',
        status: example.status,
        priority: example.priority,
        dueDate: example.dueInDays === undefined ? null : addDays(example.dueInDays),
        completedAt: example.status === 'done' ? new Date() : null,
        rank,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
  })
  await em.flush()
}
