import { type CustomerAuthContext, getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { NextResponse } from 'next/server'

export type PortalOrdersContext = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
}

export function amountField(record: Record<string, unknown>, key: string): string | number | null {
  const value = record[key]
  if (typeof value === 'string' || typeof value === 'number') return value
  return null
}

export async function resolvePortalOrdersContext(req: Request): Promise<PortalOrdersContext | Response> {
  const auth = await getCustomerAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.customerAccountNotLinked', 'Customer account is not linked to a customer record') }, { status: 403 })
  }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  return {
    auth,
    customerId: auth.customerEntityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    container,
    em,
  }
}
