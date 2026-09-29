import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import { resolveOrganizationScopeForRequest, type OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RequestContext } from '@open-mercato/shared/lib/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CatalogProduct } from '../../data/entities'

type CatalogProductScope = {
  em: EntityManager
  product: CatalogProduct
  scope: OrganizationScope
  tenantId: string
  organizationId: string
}

export async function resolveCatalogProductScope(
  ctx: RequestContext,
  request: NextRequest,
  productId: string,
  options: { requireConcreteOrganization?: boolean } = {},
): Promise<CatalogProductScope> {
  if (!ctx.auth?.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }

  const scope = await resolveOrganizationScopeForRequest({
    container: ctx.container,
    auth: ctx.auth,
    request,
  })
  const tenantId = scope.tenantId ?? ctx.auth.tenantId

  if (scope.selectionRejected) {
    throw new CrudHttpError(400, {
      error: 'Organization selection is no longer available',
      code: 'organization_scope_required',
    })
  }

  if (options.requireConcreteOrganization && !scope.selectedId) {
    throw new CrudHttpError(400, {
      error: 'Select an organization to modify this resource',
      code: 'organization_scope_required',
    })
  }

  const em = ctx.container.resolve<EntityManager>('em').fork()
  const where: FilterQuery<CatalogProduct> = {
    id: productId,
    tenantId,
    deletedAt: null,
  }
  if (scope.filterIds !== null) {
    where.organizationId = { $in: scope.filterIds }
  }

  const product = await em.findOne(CatalogProduct, where)
  if (!product) {
    throw new CrudHttpError(404, { error: 'Product not found' })
  }

  return {
    em,
    product,
    scope,
    tenantId,
    organizationId: product.organizationId,
  }
}
