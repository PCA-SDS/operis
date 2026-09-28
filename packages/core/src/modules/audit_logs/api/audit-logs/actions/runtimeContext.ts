import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

export async function createRuntimeContext(container: AwilixContainer, auth: AuthContext, request: Request): Promise<CommandRuntimeContext> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  return {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope.selectedId,
    organizationIds: scope.filterIds,
    request,
  }
}
