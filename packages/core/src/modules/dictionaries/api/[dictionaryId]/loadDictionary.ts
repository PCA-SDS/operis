import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Dictionary } from '@open-mercato/core/modules/dictionaries/data/entities'

export async function loadDictionary(
  context: Awaited<ReturnType<typeof resolveDictionariesRouteContext>>,
  id: string,
  options: { allowInherited?: boolean } = {},
) {
  const { allowInherited = false } = options
  if (!allowInherited && !context.organizationId) {
    throw new CrudHttpError(400, { error: context.translate('dictionaries.errors.organization_required', 'Organization context is required') })
  }
  const baseFilter = {
    id,
    tenantId: context.tenantId,
    deletedAt: null,
  }
  const filter = allowInherited
    ? {
        ...baseFilter,
        ...(context.readableOrganizationIds.length
          ? { organizationId: { $in: context.readableOrganizationIds } }
          : {}),
      }
    : {
        ...baseFilter,
        organizationId: context.organizationId,
      }
  const dictionary = await context.em.findOne(Dictionary, filter)
  if (!dictionary) {
    throw new CrudHttpError(404, { error: context.translate('dictionaries.errors.not_found', 'Dictionary not found') })
  }
  return dictionary
}
