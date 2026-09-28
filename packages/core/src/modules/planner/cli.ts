import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedPlannerAvailabilityRuleSetDefaults, seedPlannerUnavailabilityReasons, type PlannerSeedScope } from './lib/seeds'
import { parseCliValueArgs } from '@open-mercato/shared/lib/cli/args'

const seedAvailabilityRuleSetsCommand: ModuleCli = {
  command: 'seed-availability-rulesets',
  async run(rest) {
    const args = parseCliValueArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato planner seed-availability-rulesets --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: PlannerSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedPlannerAvailabilityRuleSetDefaults(tem, scope)
      })
      console.log('🗓️  Planner availability rule sets seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedUnavailabilityReasonsCommand: ModuleCli = {
  command: 'seed-unavailability-reasons',
  async run(rest) {
    const args = parseCliValueArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato planner seed-unavailability-reasons --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: PlannerSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedPlannerUnavailabilityReasons(tem, scope)
      })
      console.log('🗓️  Planner unavailability reasons seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedAvailabilityRuleSetsCommand, seedUnavailabilityReasonsCommand]
