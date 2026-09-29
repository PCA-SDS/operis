import { createLogger } from '@open-mercato/shared/lib/logger'
import { UUID_SHAPE_PATTERN } from '@open-mercato/shared/lib/validation/uuid'
import {
  getAllIntegrations,
  getIntegration,
  type IntegrationCredentialResolutionConfig,
  type IntegrationDefinition,
  type IntegrationScope,
} from '@open-mercato/shared/modules/integrations/types'
import {
  IntegrationCredentialError,
  createIntegrationSecret,
  isIntegrationCredentialError,
  type IntegrationCredentialFallbackPolicy,
  type IntegrationCredentialRequest,
  type IntegrationCredentialResolver,
  type IntegrationCredentialScopeInput,
  type IntegrationCredentialService,
  type IntegrationServiceCredentialRequest,
  type IntegrationServiceStatus,
  type ResolvedIntegrationCredential,
  type ResolvedServiceCredentials,
} from '@open-mercato/shared/modules/integrations/credential-resolution'
import type { CredentialsReadResult } from './credentials-service'

type EnvLookup = Record<string, string | undefined>

export const CREDENTIAL_FALLBACK_POLICY_ENV: Readonly<Record<IntegrationCredentialService, string>> = {
  email: 'OM_EMAIL_CREDENTIAL_FALLBACK',
  ai: 'OM_AI_CREDENTIAL_FALLBACK',
}

export const PLATFORM_FALLBACK_LOG_CODE = 'credentials.platform_fallback'

export type PlatformUsageRecord = {
  integrationId: string
  service: IntegrationCredentialService
  operation: string
  correlationId: string | null
}

export type CredentialResolverDependencies = {
  credentials: {
    readForResolution(integrationId: string, scope: IntegrationScope): Promise<CredentialsReadResult>
    readManyForResolution(integrationIds: readonly string[], scope: IntegrationScope): Promise<Map<string, CredentialsReadResult>>
  }
  state: {
    isEnabled(integrationId: string, scope: IntegrationScope): Promise<boolean>
  }
  recordPlatformUsage(record: PlatformUsageRecord, scope: IntegrationScope): Promise<void>
  env?: EnvLookup
}

type ResolvableDefinition = IntegrationDefinition & { credentialResolution: IntegrationCredentialResolutionConfig }

const logger = createLogger('integrations').child({ component: 'credential-resolver' })

const warnedPolicyValues = new Set<string>()

export function resolveCredentialFallbackPolicy(
  service: IntegrationCredentialService,
  env: EnvLookup = process.env,
): IntegrationCredentialFallbackPolicy {
  const variable = CREDENTIAL_FALLBACK_POLICY_ENV[service]
  const raw = env[variable]?.trim().toLowerCase()
  if (!raw || raw === 'disabled') return 'disabled'
  if (raw === 'platform') return 'platform'
  const warningKey = `${variable}=${raw}`
  if (!warnedPolicyValues.has(warningKey)) {
    warnedPolicyValues.add(warningKey)
    logger.warn('Unrecognised credential fallback policy; platform credentials stay disabled', {
      service,
      variable,
      allowed: ['disabled', 'platform'],
    })
  }
  return 'disabled'
}

function isResolvable(definition: IntegrationDefinition | undefined): definition is ResolvableDefinition {
  return Boolean(definition?.credentialResolution)
}

function listServiceDefinitions(service: IntegrationCredentialService): ResolvableDefinition[] {
  return getAllIntegrations()
    .filter(isResolvable)
    .filter((definition) => definition.credentialResolution.service === service)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return UUID_SHAPE_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null
}

function requireScope(
  input: IntegrationCredentialScopeInput,
  context: { integrationId?: string; service?: IntegrationCredentialService },
): IntegrationScope {
  const tenantId = normalizeId(input.tenantId)
  const organizationId = normalizeId(input.organizationId)
  if (!tenantId || !organizationId) {
    throw new IntegrationCredentialError('tenant_context_missing', {
      integrationId: context.integrationId ?? null,
      service: context.service ?? null,
    })
  }
  return { tenantId, organizationId, userId: null }
}

function requireDefinition(integrationId: string): ResolvableDefinition {
  const definition = getIntegration(integrationId)
  if (!isResolvable(definition)) {
    throw new IntegrationCredentialError('provider_unsupported', { integrationId })
  }
  return definition
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function secretFieldKeys(definition: ResolvableDefinition): Set<string> {
  const keys = new Set<string>([definition.credentialResolution.secretField])
  for (const field of definition.credentials?.fields ?? []) {
    if (field.type === 'secret' || field.type === 'oauth' || field.type === 'ssh_keypair') keys.add(field.key)
  }
  return keys
}

function collectSettings(values: Record<string, unknown>, excluded: Set<string>): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (excluded.has(key)) continue
    const text = readString(value)
    if (text) settings[key] = text
  }
  return Object.freeze(settings)
}

function readPlatformValues(definition: ResolvableDefinition, env: EnvLookup): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [field, names] of Object.entries(definition.credentialResolution.platformEnv)) {
    for (const name of names) {
      const value = readString(env[name])
      if (value) {
        values[field] = value
        break
      }
    }
  }
  return values
}

function buildCredential(
  definition: ResolvableDefinition,
  scope: IntegrationScope,
  source: ResolvedIntegrationCredential['source'],
  secretValue: string,
  values: Record<string, unknown>,
): ResolvedIntegrationCredential {
  return Object.freeze({
    integrationId: definition.id,
    service: definition.credentialResolution.service,
    source,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requiresUsageAttribution: source === 'platform',
    secret: createIntegrationSecret(secretValue),
    settings: collectSettings(values, secretFieldKeys(definition)),
  })
}

export function createIntegrationCredentialResolver(deps: CredentialResolverDependencies): IntegrationCredentialResolver {
  const env = deps.env ?? process.env

  async function readStrict<T>(
    read: () => Promise<T>,
    context: { integrationId: string | null; service: IntegrationCredentialService },
    scope: IntegrationScope,
  ): Promise<T> {
    try {
      return await read()
    } catch (error) {
      logger.error('Stored organization credentials could not be read; no fallback is attempted', {
        ...context,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        err: error,
      })
      if (isIntegrationCredentialError(error)) throw error
      throw new IntegrationCredentialError('credential_unreadable', { ...context, cause: error })
    }
  }

  function toCustomerCredential(
    definition: ResolvableDefinition,
    scope: IntegrationScope,
    result: CredentialsReadResult | undefined,
  ): ResolvedIntegrationCredential | null {
    if (!result || result.status === 'missing') return null
    const secretValue = readString(result.values[definition.credentialResolution.secretField])
    if (!secretValue) return null
    return buildCredential(definition, scope, 'customer', secretValue, result.values)
  }

  async function readCustomerCredential(
    definition: ResolvableDefinition,
    scope: IntegrationScope,
  ): Promise<ResolvedIntegrationCredential | null> {
    const result = await readStrict(
      () => deps.credentials.readForResolution(definition.id, scope),
      { integrationId: definition.id, service: definition.credentialResolution.service },
      scope,
    )
    return toCustomerCredential(definition, scope, result)
  }

  function readPlatformCredential(definition: ResolvableDefinition, scope: IntegrationScope): ResolvedIntegrationCredential | null {
    const values = readPlatformValues(definition, env)
    const secretValue = values[definition.credentialResolution.secretField]
    if (!secretValue) return null
    return buildCredential(definition, scope, 'platform', secretValue, values)
  }

  async function recordPlatformUse(
    definition: ResolvableDefinition,
    scope: IntegrationScope,
    operation: string,
    correlationId: string | null,
  ): Promise<void> {
    await recordPlatformUseFor(
      { integrationId: definition.id, service: definition.credentialResolution.service },
      scope,
      operation,
      correlationId,
    )
  }

  async function recordPlatformUseFor(
    target: { integrationId: string; service: IntegrationCredentialService },
    scope: IntegrationScope,
    operation: string,
    correlationId: string | null,
  ): Promise<void> {
    const record: PlatformUsageRecord = {
      integrationId: target.integrationId,
      service: target.service,
      operation,
      correlationId,
    }
    try {
      await deps.recordPlatformUsage(record, scope)
    } catch (error) {
      logger.error('Platform credential usage could not be recorded; the operation is blocked', {
        ...record,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        err: error,
      })
      throw new IntegrationCredentialError('usage_recording_failed', {
        integrationId: target.integrationId,
        service: target.service,
        cause: error,
      })
    }
    logger.info('Platform credential used on behalf of an organization', {
      ...record,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }

  function denyNotConfigured(
    service: IntegrationCredentialService,
    scope: IntegrationScope,
    operation: string,
    integrationId: string | null,
  ): IntegrationCredentialError {
    logger.info('Organization credential not configured and platform fallback is disabled', {
      service,
      integrationId,
      operation,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return new IntegrationCredentialError('integration_not_configured', { integrationId, service })
  }

  function requirePlatformCredential(definition: ResolvableDefinition, scope: IntegrationScope): ResolvedIntegrationCredential {
    const credential = readPlatformCredential(definition, scope)
    if (credential) return credential
    logger.error('Platform fallback is allowed but the platform credential is not configured', {
      integrationId: definition.id,
      service: definition.credentialResolution.service,
    })
    throw new IntegrationCredentialError('platform_credential_unavailable', {
      integrationId: definition.id,
      service: definition.credentialResolution.service,
    })
  }

  async function requireEnabled(definition: ResolvableDefinition, scope: IntegrationScope): Promise<void> {
    if (await deps.state.isEnabled(definition.id, scope)) return
    throw new IntegrationCredentialError('integration_disabled', {
      integrationId: definition.id,
      service: definition.credentialResolution.service,
    })
  }

  async function readEnabledCustomerCredentials(
    service: IntegrationCredentialService,
    definitions: ResolvableDefinition[],
    scope: IntegrationScope,
  ): Promise<ResolvedIntegrationCredential[]> {
    if (definitions.length === 0) return []
    const results = await readStrict(
      () => deps.credentials.readManyForResolution(definitions.map((definition) => definition.id), scope),
      { integrationId: null, service },
      scope,
    )
    const credentials: ResolvedIntegrationCredential[] = []
    for (const definition of definitions) {
      const credential = toCustomerCredential(definition, scope, results.get(definition.id))
      if (!credential) continue
      if (!(await deps.state.isEnabled(definition.id, scope))) continue
      credentials.push(credential)
    }
    return credentials
  }

  return {
    async resolve(request: IntegrationCredentialRequest): Promise<ResolvedIntegrationCredential> {
      const definition = requireDefinition(request.integrationId)
      const service = definition.credentialResolution.service
      const scope = requireScope(request.scope, { integrationId: definition.id, service })
      await requireEnabled(definition, scope)
      const customer = await readCustomerCredential(definition, scope)
      if (customer) return customer
      if (resolveCredentialFallbackPolicy(service, env) !== 'platform') {
        throw denyNotConfigured(service, scope, request.operation, definition.id)
      }
      const platform = requirePlatformCredential(definition, scope)
      await recordPlatformUse(definition, scope, request.operation, request.correlationId ?? null)
      return platform
    },

    async resolveService(request: IntegrationServiceCredentialRequest): Promise<ResolvedServiceCredentials> {
      const scope = requireScope(request.scope, { service: request.service })
      const definitions = listServiceDefinitions(request.service)
      const customer = await readEnabledCustomerCredentials(request.service, definitions, scope)
      const base = { service: request.service, tenantId: scope.tenantId, organizationId: scope.organizationId }
      if (customer.length > 0) {
        return Object.freeze({
          ...base,
          source: 'customer' as const,
          credentials: Object.freeze(customer),
          markUsed: async () => undefined,
        })
      }
      if (resolveCredentialFallbackPolicy(request.service, env) !== 'platform') {
        throw denyNotConfigured(request.service, scope, request.operation, null)
      }
      const platform = definitions
        .map((definition) => readPlatformCredential(definition, scope))
        .filter((credential): credential is ResolvedIntegrationCredential => credential !== null)
      return Object.freeze({
        ...base,
        source: 'platform' as const,
        credentials: Object.freeze(platform),
        async markUsed(integrationId: string) {
          const definition = getIntegration(integrationId)
          if (!integrationId.trim() || (definition?.credentialResolution && definition.credentialResolution.service !== request.service)) {
            throw new IntegrationCredentialError('provider_unsupported', { integrationId, service: request.service })
          }
          await recordPlatformUseFor(
            { integrationId, service: request.service },
            scope,
            request.operation,
            request.correlationId ?? null,
          )
        },
      })
    },

    async authorizePlatformUse(request: IntegrationCredentialRequest): Promise<void> {
      const definition = requireDefinition(request.integrationId)
      const service = definition.credentialResolution.service
      const scope = requireScope(request.scope, { integrationId: definition.id, service })
      if (resolveCredentialFallbackPolicy(service, env) !== 'platform') {
        logger.warn('Platform-only operation refused because platform credentials are disabled', {
          service,
          integrationId: definition.id,
          operation: request.operation,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        throw new IntegrationCredentialError('platform_fallback_prohibited', { integrationId: definition.id, service })
      }
      await recordPlatformUse(definition, scope, request.operation, request.correlationId ?? null)
    },

    async getServiceStatus(input): Promise<IntegrationServiceStatus> {
      const scope = requireScope(input.scope, { service: input.service })
      const definitions = listServiceDefinitions(input.service)
      const platformFallbackAllowed = resolveCredentialFallbackPolicy(input.service, env) === 'platform'
      const customer = await readEnabledCustomerCredentials(input.service, definitions, scope)
      if (customer.length > 0) {
        return {
          service: input.service,
          configured: true,
          source: 'customer',
          integrationIds: customer.map((credential) => credential.integrationId),
          platformFallbackAllowed,
        }
      }
      if (platformFallbackAllowed) {
        const platformIds = definitions
          .filter((definition) => readPlatformCredential(definition, scope) !== null)
          .map((definition) => definition.id)
        if (platformIds.length > 0) {
          return { service: input.service, configured: true, source: 'platform', integrationIds: platformIds, platformFallbackAllowed }
        }
      }
      return { service: input.service, configured: false, source: null, integrationIds: [], platformFallbackAllowed }
    },
  }
}
