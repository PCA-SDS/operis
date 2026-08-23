import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'

export function register(container: AppContainer) {
  // `asClass` (not `asFunction`): the container uses Awilix CLASSIC injection,
  // which resolves by parameter name. TenantModuleService's constructor params
  // are `em` and `cache`, both registered — an `asFunction((cradle) => …)` form
  // would make Awilix look for a registration literally named `cradle`.
  container.register({ tenantModuleService: asClass(TenantModuleService).scoped() })
}
