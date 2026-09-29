import {
  IntegrationCredentialError,
  createIntegrationSecret,
  type IntegrationCredentialRequest,
  type IntegrationCredentialResolver,
  type IntegrationCredentialService,
  type IntegrationCredentialSource,
  type IntegrationServiceCredentialRequest,
  type ResolvedIntegrationCredential,
} from '../../modules/integrations/credential-resolution'

export type TestCredentialEntry = {
  secret: string
  service?: IntegrationCredentialService
  source?: IntegrationCredentialSource
  settings?: Record<string, string>
}

export type TestCredentialResolver = IntegrationCredentialResolver & {
  requests: Array<IntegrationCredentialRequest | IntegrationServiceCredentialRequest>
  used: string[]
}

function buildScope(scope: IntegrationCredentialRequest['scope']): { tenantId: string; organizationId: string } {
  if (!scope.tenantId || !scope.organizationId) {
    throw new IntegrationCredentialError('tenant_context_missing')
  }
  return { tenantId: scope.tenantId, organizationId: scope.organizationId }
}

/**
 * In-memory `IntegrationCredentialResolver` for unit tests. Keys are integration ids; a missing
 * id behaves like an organization without that credential under the `disabled` policy.
 */
export function createTestCredentialResolver(
  entries: Record<string, TestCredentialEntry> = {},
  options: {
    failWith?: IntegrationCredentialError
    defaultService?: IntegrationCredentialService
    platformFallbackAllowed?: boolean
  } = {},
): TestCredentialResolver {
  const defaultService = options.defaultService ?? 'email'
  const requests: TestCredentialResolver['requests'] = []
  const used: string[] = []

  function build(integrationId: string, entry: TestCredentialEntry, scope: { tenantId: string; organizationId: string }): ResolvedIntegrationCredential {
    const source = entry.source ?? 'customer'
    return {
      integrationId,
      service: entry.service ?? defaultService,
      source,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      requiresUsageAttribution: source === 'platform',
      secret: createIntegrationSecret(entry.secret),
      settings: entry.settings ?? {},
    }
  }

  return {
    requests,
    used,
    async resolve(request) {
      requests.push(request)
      if (options.failWith) throw options.failWith
      const scope = buildScope(request.scope)
      const entry = entries[request.integrationId]
      if (!entry) {
        throw new IntegrationCredentialError('integration_not_configured', {
          integrationId: request.integrationId,
          service: defaultService,
        })
      }
      return build(request.integrationId, entry, scope)
    },
    async resolveService(request) {
      requests.push(request)
      if (options.failWith) throw options.failWith
      const scope = buildScope(request.scope)
      const credentials = Object.entries(entries)
        .filter(([, entry]) => (entry.service ?? defaultService) === request.service)
        .map(([integrationId, entry]) => build(integrationId, entry, scope))
      if (credentials.length === 0) {
        if (!options.platformFallbackAllowed) {
          throw new IntegrationCredentialError('integration_not_configured', { service: request.service })
        }
        return {
          service: request.service,
          source: 'platform' as const,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          credentials: [],
          async markUsed(integrationId: string) {
            used.push(integrationId)
          },
        }
      }
      return {
        service: request.service,
        source: credentials[0].source,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        credentials,
        async markUsed(integrationId: string) {
          if (credentials[0].source === 'platform') used.push(integrationId)
        },
      }
    },
    async authorizePlatformUse(request) {
      requests.push(request)
      if (options.failWith) throw options.failWith
      buildScope(request.scope)
      if (!options.platformFallbackAllowed) {
        throw new IntegrationCredentialError('platform_fallback_prohibited', {
          integrationId: request.integrationId,
          service: defaultService,
        })
      }
      used.push(request.integrationId)
    },
    async getServiceStatus(input) {
      buildScope(input.scope)
      const integrationIds = Object.entries(entries)
        .filter(([, entry]) => (entry.service ?? defaultService) === input.service)
        .map(([integrationId]) => integrationId)
      return {
        service: input.service,
        configured: integrationIds.length > 0,
        source: integrationIds.length > 0 ? entries[integrationIds[0]].source ?? 'customer' : null,
        integrationIds,
        platformFallbackAllowed: options.platformFallbackAllowed ?? false,
      }
    },
  }
}
