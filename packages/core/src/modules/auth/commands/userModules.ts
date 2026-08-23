import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import { featureNotAvailable } from '@open-mercato/shared/security/entitlementErrors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { enforceTenantSelection } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { UserModuleService } from '@open-mercato/core/modules/auth/lib/userModules'
import type { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'
import { isEntitleableModule } from '@open-mercato/core/modules/directory/lib/tenantModules'

const setUserModuleSchema = z.object({
  userId: z.string().uuid(),
  moduleId: z.string().min(1),
  isEnabled: z.boolean(),
})

export type SetUserModuleInput = z.infer<typeof setUserModuleSchema>

export type SetUserModuleResult = {
  userId: string
  tenantId: string | null
  moduleId: string
  isEnabled: boolean
  previousIsEnabled: boolean
}

/**
 * Resolves the user this write targets and proves the actor may address them.
 *
 * `enforceTenantSelection` is the same guard the tenant-scoped API surface uses:
 * a platform super admin may target any tenant, anyone else only their own. It
 * runs before the entitlement lookup so a cross-tenant probe cannot be used to
 * discover which modules another tenant holds.
 */
async function resolveTarget(input: SetUserModuleInput, ctx: CommandRuntimeContext) {
  const { translate } = await resolveTranslations()
  const em = ctx.container.resolve('em') as EntityManager
  const user = await em.fork().findOne(User, { id: input.userId, deletedAt: null })
  if (!user) {
    throw notFound(translate('auth.userModules.errors.userNotFound', 'User not found'))
  }
  await enforceTenantSelection(ctx, user.tenantId ?? null)
  return { translate, user, tenantId: user.tenantId ?? null }
}

const setUserModuleCommand: CommandHandler<SetUserModuleInput, SetUserModuleResult> = {
  id: 'auth.user_modules.set',

  async prepare(rawInput, ctx) {
    const input = setUserModuleSchema.parse(rawInput)
    const { user, tenantId } = await resolveTarget(input, ctx)
    const userModules = ctx.container.resolve('userModuleService') as UserModuleService
    const restricted = await userModules.getRestrictedModuleIds(user.id, tenantId)
    return { before: { userId: user.id, tenantId, moduleId: input.moduleId, isEnabled: !restricted.includes(input.moduleId) } }
  },

  async execute(rawInput, ctx) {
    const input = setUserModuleSchema.parse(rawInput)
    const { translate, user, tenantId } = await resolveTarget(input, ctx)

    if (!isEntitleableModule(input.moduleId)) {
      throw badRequest(translate(
        'auth.userModules.errors.platformModule',
        'Platform modules cannot be restricted per user.',
      ))
    }

    // Rule 2: a tenant admin may not act on a module their tenant does not hold.
    // This covers the enable direction (which would be a no-op anyway, since the
    // user layer only subtracts) *and* the disable direction, so the API never
    // stores a restriction for a module that is not part of the tenant's plan.
    const tenantModules = ctx.container.resolve('tenantModuleService') as TenantModuleService
    const tenantHasModule = await tenantModules.isModuleEnabled(tenantId, input.moduleId)
    if (!tenantHasModule) {
      throw featureNotAvailable(
        translate(
          'auth.userModules.errors.notEntitled',
          'This module is not available to the tenant, so it cannot be assigned to a user.',
        ),
        input.moduleId,
      )
    }

    const userModules = ctx.container.resolve('userModuleService') as UserModuleService
    const previousRestricted = await userModules.getRestrictedModuleIds(user.id, tenantId)
    const previousIsEnabled = !previousRestricted.includes(input.moduleId)

    await userModules.setModuleEnabled(user.id, tenantId, input.moduleId, input.isEnabled)

    return {
      userId: user.id,
      tenantId,
      moduleId: input.moduleId,
      isEnabled: input.isEnabled,
      previousIsEnabled,
    }
  },

  buildLog({ result, ctx }) {
    return {
      tenantId: result.tenantId,
      organizationId: ctx.auth?.orgId ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      actionLabel: result.isEnabled ? 'Granted module to user' : 'Withheld module from user',
      resourceKind: 'auth.user_module',
      resourceId: `${result.userId}:${result.moduleId}`,
      parentResourceKind: 'auth.user',
      parentResourceId: result.userId,
      changes: {
        isEnabled: { from: result.previousIsEnabled, to: result.isEnabled },
      },
      context: {
        moduleId: result.moduleId,
        userId: result.userId,
      },
    }
  },
}

registerCommand(setUserModuleCommand)

export { setUserModuleCommand }
