import { z } from 'zod'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { requireSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import {
  buildModuleDependencyGraph,
  isEntitleableModule,
  resolveReachableModuleIds,
  type TenantModuleService,
} from '@open-mercato/core/modules/directory/lib/tenantModules'

const setTenantModuleSchema = z.object({
  tenantId: z.string().uuid(),
  moduleId: z.string().min(1),
  isEnabled: z.boolean(),
})

export type SetTenantModuleInput = z.infer<typeof setTenantModuleSchema>

export type SetTenantModuleResult = {
  tenantId: string
  moduleId: string
  isEnabled: boolean
  previousIsEnabled: boolean
  /** Enabled modules that lost reachability because this one was switched off. */
  cascadedOff: string[]
}

async function resolveService(ctx: CommandRuntimeContext): Promise<TenantModuleService> {
  return ctx.container.resolve('tenantModuleService') as TenantModuleService
}

const setTenantModuleCommand: CommandHandler<SetTenantModuleInput, SetTenantModuleResult> = {
  id: 'directory.tenant_modules.set',

  async execute(rawInput, ctx) {
    const input = setTenantModuleSchema.parse(rawInput)
    const { translate } = await resolveTranslations()

    // Entitlement is the platform's lever over a tenant, so only a platform
    // super admin may move it — a tenant admin editing their own tenant's plan
    // would defeat the whole hierarchy.
    await requireSuperAdmin(ctx)

    if (!isEntitleableModule(input.moduleId)) {
      throw badRequest(translate(
        'directory.tenantModules.errors.platformModule',
        'Platform modules are always available and cannot be entitled per tenant.',
      ))
    }

    const service = await resolveService(ctx)
    const stored = await service.listTenantModules(input.tenantId)
    const storedEnabled = new Set(stored.filter((row) => row.isEnabled).map((row) => row.moduleId))
    const graph = buildModuleDependencyGraph()

    // Enabling a module whose hard prerequisites are withheld would store an
    // invalid state — the module would sit "on" while resolution keeps it
    // unreachable. Reject it at the source and name what to enable first,
    // rather than letting the operator create a switch that does nothing.
    if (input.isEnabled) {
      const missing = (graph.get(input.moduleId) ?? []).filter((dep) => !storedEnabled.has(dep))
      if (missing.length) {
        throw badRequest(translate(
          'directory.tenantModules.errors.missingDependencies',
          'Enable {dependencies} for this tenant first — {module} depends on it.',
          { dependencies: missing.join(', '), module: input.moduleId },
        ))
      }
    }

    const previousIsEnabled = storedEnabled.has(input.moduleId)
    await service.setModuleEnabled(input.tenantId, input.moduleId, input.isEnabled)

    // Switching a prerequisite off takes its dependents with it. The blast radius
    // is the difference between what resolved before and after — computed with the
    // same resolver the gates use, so it stays exact for transitive chains
    // (`planner` off also costs `staff`, which only requires `resources`) instead
    // of a direct-dependent scan that would under-report.
    const nextStored = new Set(storedEnabled)
    if (input.isEnabled) nextStored.add(input.moduleId)
    else nextStored.delete(input.moduleId)
    const before = new Set(resolveReachableModuleIds(Array.from(storedEnabled), graph))
    const after = new Set(resolveReachableModuleIds(Array.from(nextStored), graph))
    const cascadedOff = Array.from(before)
      .filter((moduleId) => moduleId !== input.moduleId && !after.has(moduleId))
      .sort((left, right) => left.localeCompare(right))

    return {
      tenantId: input.tenantId,
      moduleId: input.moduleId,
      isEnabled: input.isEnabled,
      previousIsEnabled,
      cascadedOff,
    }
  },

  buildLog({ result, ctx }) {
    return {
      tenantId: result.tenantId,
      organizationId: ctx.auth?.orgId ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      actionLabel: result.isEnabled ? 'Granted module to tenant' : 'Withheld module from tenant',
      resourceKind: 'directory.tenant_module',
      resourceId: `${result.tenantId}:${result.moduleId}`,
      parentResourceKind: 'directory.tenant',
      parentResourceId: result.tenantId,
      changes: {
        isEnabled: { from: result.previousIsEnabled, to: result.isEnabled },
      },
      context: {
        moduleId: result.moduleId,
        ...(result.cascadedOff.length ? { cascadedOff: result.cascadedOff } : {}),
      },
    }
  },
}

registerCommand(setTenantModuleCommand)

export { setTenantModuleCommand }
