import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

/**
 * @deprecated Moved to `@open-mercato/shared/lib/auth/organizationScope` as
 * `resolveActiveOrganizationId`, because `data_sync` needs the same resolution and
 * `integrations` is not the right owner for it. This alias stays for third-party
 * modules that already import from here.
 */
export { resolveActiveOrganizationId as resolveIntegrationsOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'

export async function resolveIntegrationsOrganizationIdForRequest(input: {
  container: AwilixContainer
  auth: Exclude<AuthContext, null>
  request: Request
}): Promise<string | null> {
  const scope = await resolveOrganizationScopeForRequest({
    container: input.container,
    auth: input.auth,
    request: input.request,
  })

  return scope.selectedId ?? resolveActiveOrganizationId(input.auth)
}
