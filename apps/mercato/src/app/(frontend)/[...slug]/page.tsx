import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { findRouteManifestMatch, getFrontendRouteManifests, registerFrontendRouteManifests } from '@open-mercato/shared/modules/registry'
import { frontendRoutes } from '@/.mercato/generated/frontend-routes.generated'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { AccessDeniedMessage } from '@open-mercato/ui/backend/detail'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import type { TenantModuleService } from '@open-mercato/core/modules/directory/lib/tenantModules'
import { isEntitleableModule } from '@open-mercato/core/modules/directory/lib/tenantModules'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { Metadata } from 'next'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveLocalizedTitleMetadata } from '@/lib/metadata'
import { resolvePageMiddlewareRedirect } from '@open-mercato/shared/lib/middleware/page-executor'
import { frontendMiddlewareEntries } from '@/.mercato/generated/frontend-middleware.generated'

registerFrontendRouteManifests(frontendRoutes)

type FrontendParams = { params: Promise<{ slug: string[] }> }

async function ensureServerBootstrap() {
  const { bootstrap } = await import('@/bootstrap')
  bootstrap()
}

async function renderAccessDenied() {
  const { translate } = await resolveTranslations()
  return (
    <AccessDeniedMessage
      label={translate('auth.accessDenied.title', 'Access Denied')}
      description={translate('auth.accessDenied.message', 'You do not have permission to view this page. Please contact your administrator.')}
      action={
        <Link href="/" className="text-sm underline hover:opacity-80">
          {translate('auth.accessDenied.home', 'Go to Home')}
        </Link>
      }
    />
  )
}

export async function generateMetadata({ params }: FrontendParams): Promise<Metadata> {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const match = findRouteManifestMatch(getFrontendRouteManifests(), pathname)
  if (!match) {
    return {}
  }

  return resolveLocalizedTitleMetadata({
    title: match.route.title,
    titleKey: match.route.titleKey,
  })
}

export default async function SiteCatchAll({ params }: FrontendParams) {
  const p = await params
  const pathname = '/' + (p.slug?.join('/') ?? '')
  const match = findRouteManifestMatch(getFrontendRouteManifests(), pathname)
  if (!match) return notFound()

  // Customer portal auth gate — separate from staff auth
  if (match.route.requireCustomerAuth) {
    const { getCustomerAuthFromCookies } = await import('@open-mercato/core/modules/customer_accounts/lib/customerAuthServer')
    const customerAuth = await getCustomerAuthFromCookies()
    const segments = pathname.split('/').filter(Boolean)
    const orgSlug = segments[0] ?? ''
    if (!customerAuth) {
      redirect(`/${orgSlug}/portal/login`)
    }
    await ensureServerBootstrap()
    const portalContainer = await createRequestContainer()
    const em = portalContainer.resolve('em') as EntityManager
    const org = orgSlug
      ? await em.findOne(Organization, {
          id: customerAuth.orgId,
          slug: orgSlug,
          deletedAt: null,
        } as any)
      : null
    const organizationId = org ? String(org.id) : null
    if (!organizationId || organizationId !== customerAuth.orgId) return renderAccessDenied()

    // Module entitlement, ahead of the portal RBAC check. The portal is a
    // separate realm with its own role model, but it is served by ordinary
    // modules — a tenant that lost `portal` must not keep serving its pages to
    // customers. Only the tenant layer applies: `user_modules` keys on staff
    // users, and a portal customer is not one.
    const portalModuleId = match.route.moduleId
    if (portalModuleId && isEntitleableModule(portalModuleId)) {
      const tenantModules = portalContainer.resolve('tenantModuleService') as TenantModuleService
      const moduleAllowed = await tenantModules.isModuleEnabled(customerAuth.tenantId ?? null, portalModuleId)
      if (!moduleAllowed) return renderAccessDenied()
    }

    const customerFeatures = match.route.requireCustomerFeatures
    if (customerFeatures && customerFeatures.length) {
      const customerRbac = portalContainer.resolve('customerRbacService') as CustomerRbacService
      const ok = await customerRbac.userHasAllFeatures(
        customerAuth.sub,
        customerFeatures as string[],
        { tenantId: customerAuth.tenantId, organizationId: customerAuth.orgId },
      )
      if (!ok) return renderAccessDenied()
    }
    const Component = await match.route.load()
    return <Component params={match.params} />
  }

  // Staff auth gate
  let auth: AuthContext = null
  let container: Awaited<ReturnType<typeof createRequestContainer>> | null = null
  const ensureContainer = async () => {
    if (!container) {
      await ensureServerBootstrap()
      container = await createRequestContainer()
    }
    return container
  }
  if (match.route.requireAuth) {
    auth = await getAuthFromCookies()
    if (!auth) redirect('/api/auth/session/refresh?redirect=' + encodeURIComponent(pathname))
    const required = match.route.requireRoles || []
    if (required.length) {
      const roles = auth.roles || []
      const ok = required.some(r => roles.includes(r))
      if (!ok) return renderAccessDenied()
    }
    // Same two-step as the backend catch-all: module entitlement first (it
    // applies even to a page that declares no features), then RBAC.
    const staffModuleId = match.route.moduleId
    if (staffModuleId) {
      const scopeContainer = await ensureContainer()
      const rbac = scopeContainer.resolve('rbacService') as RbacService
      const moduleAllowed = await rbac.isModuleAllowedForUser(auth.sub, staffModuleId, {
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      })
      if (!moduleAllowed) return renderAccessDenied()
    }
    const features = match.route.requireFeatures
    if (features && features.length) {
      const scopeContainer = await ensureContainer()
      const rbac = scopeContainer.resolve('rbacService') as RbacService
      const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: auth.orgId })
      if (!ok) return renderAccessDenied()
    }
  }
  const middlewareRedirect = await resolvePageMiddlewareRedirect({
    entries: frontendMiddlewareEntries,
    context: {
      pathname,
      mode: 'frontend',
      routeMeta: {
        requireAuth: match.route.requireAuth,
        requireRoles: match.route.requireRoles,
        requireFeatures: match.route.requireFeatures,
      },
      auth,
      ensureContainer,
    },
  })
  if (middlewareRedirect) redirect(middlewareRedirect)
  const Component = await match.route.load()
  return <Component params={match.params} />
}
