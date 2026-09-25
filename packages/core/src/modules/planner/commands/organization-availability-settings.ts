import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PlannerAvailabilityRuleSet, PlannerOrganizationAvailabilitySettings } from '../data/entities'
import {
  plannerOrganizationAvailabilitySettingsSchema,
  type PlannerOrganizationAvailabilitySettingsInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const saveOrganizationAvailabilitySettingsCommand: CommandHandler<
  PlannerOrganizationAvailabilitySettingsInput,
  { ok: true }
> = {
  id: 'planner.organization-availability-settings.save',
  async execute(rawInput, ctx) {
    const parsed = plannerOrganizationAvailabilitySettingsSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ruleSet = await em.findOne(PlannerAvailabilityRuleSet, {
      id: parsed.operatingHoursRuleSetId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!ruleSet) {
      throw new CrudHttpError(400, {
        error: 'Operating hours schedule must belong to the selected organization.',
        code: 'INVALID_OPERATING_HOURS_RULE_SET',
      })
    }

    let settings = await em.findOne(PlannerOrganizationAvailabilitySettings, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      deletedAt: null,
    })
    if (!settings) {
      const now = new Date()
      settings = em.create(PlannerOrganizationAvailabilitySettings, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        operatingHoursRuleSetId: parsed.operatingHoursRuleSetId,
        lastCustomerBeforeCloseMinutes: parsed.lastCustomerBeforeCloseMinutes ?? 0,
        timeOverflowMinutes: parsed.timeOverflowMinutes ?? 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(settings)
    } else {
      settings.operatingHoursRuleSetId = parsed.operatingHoursRuleSetId
      if (parsed.lastCustomerBeforeCloseMinutes !== undefined) {
        settings.lastCustomerBeforeCloseMinutes = parsed.lastCustomerBeforeCloseMinutes ?? 0
      }
      if (parsed.timeOverflowMinutes !== undefined) {
        settings.timeOverflowMinutes = parsed.timeOverflowMinutes ?? 0
      }
      settings.updatedAt = new Date()
    }
    await em.flush()
    return { ok: true }
  },
}

registerCommand(saveOrganizationAvailabilitySettingsCommand)
