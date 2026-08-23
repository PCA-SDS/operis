import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { TasksLabel } from './data/entities'
import { seedExampleProject } from './lib/seeds'

/** A small starter palette so the first label a user creates already has
 *  neighbours to pick from. Colours come from the DS chart palette. */
const DEFAULT_LABELS: { name: string; color: string }[] = [
  { name: 'Bug', color: '#C0483F' },
  { name: 'Feature', color: '#3F7BC0' },
  { name: 'Chore', color: '#64748B' },
  { name: 'Blocked', color: '#B45309' },
  { name: 'Customer', color: '#2F855A' },
]

async function seedLabels(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  for (const label of DEFAULT_LABELS) {
    const existing = await em.findOne(TasksLabel, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: label.name,
    })
    if (existing) continue
    em.persist(
      em.create(TasksLabel, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: label.name,
        color: label.color,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
  }
  await em.flush()
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['tasks.*'],
    employee: [
      'tasks.view',
      'tasks.create',
      'tasks.edit',
      'tasks.assign',
      'tasks.projects.view',
      'tasks.docs.view',
      'tasks.comments.create',
      'tasks.team.view',
    ],
  },

  seedDefaults: async (ctx) => {
    if (!ctx.organizationId) return
    await seedLabels(ctx.em as EntityManager, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },

  seedExamples: async (ctx) => {
    if (!ctx.organizationId) return
    await seedExampleProject(ctx.em as EntityManager, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  },
}

export default setup
