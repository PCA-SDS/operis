import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getToolRegistry } from './tool-registry'

const logger = createLogger('ai_assistant').child({ component: 'ai-entitlement' })

/**
 * Modules whose in-app AI assistant this tenant has switched OFF.
 *
 * A per-(tenant, module) sub-toggle of the module grant, set by a platform
 * super admin on the tenant's Modules screen. It is narrower than entitlement:
 * the tenant keeps the module and every non-AI surface it provides, and only
 * loses the assistant inside it. Entitlement itself is enforced upstream by
 * `RbacService`, which has already stripped a withheld module's features from
 * `userFeatures` before any tool list is built.
 *
 * Returns the DISABLED set rather than the enabled one on purpose: a tool whose
 * module is unknown to the toggle — a built-in, a module that ships no
 * assistant — must stay available, and testing "not in the disabled set" gives
 * that for free. Resolution failure yields an empty set, so an outage in the
 * directory service cannot silently disarm every AI tool in the product.
 */
export async function resolveAiDisabledModuleIds(
  container: AwilixContainer,
  tenantId: string | null | undefined,
): Promise<ReadonlySet<string>> {
  if (!tenantId) return new Set()
  try {
    const service = container.resolve('tenantModuleService') as {
      getAiDisabledModuleIds: (tenantId: string) => Promise<string[]>
    }
    return new Set(await service.getAiDisabledModuleIds(tenantId))
  } catch (err) {
    logger.warn('Could not resolve AI assistant entitlement; leaving every tool available', { tenantId, err })
    return new Set()
  }
}

/**
 * Whether a tool survives the tenant's AI entitlement.
 *
 * Applied alongside `hasRequiredFeatures` at every place a tool list is built
 * or a tool is about to run — listing it but refusing to execute it (or the
 * reverse) would be worse than either.
 */
export function isToolAiAllowed(
  toolName: string,
  aiDisabledModuleIds: ReadonlySet<string> | undefined,
): boolean {
  if (!aiDisabledModuleIds || aiDisabledModuleIds.size === 0) return true
  const moduleId = getToolRegistry().getModuleIdForTool(toolName)
  if (!moduleId) return true
  return !aiDisabledModuleIds.has(moduleId)
}
