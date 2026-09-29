import type { IntegrationCredentialService } from './types'

export type { IntegrationCredentialService } from './types'

export const INTEGRATION_CREDENTIAL_RESOLVER_KEY = 'integrationCredentialResolver'

export const INTEGRATION_CREDENTIAL_SERVICES: readonly IntegrationCredentialService[] = ['email', 'ai']

/** Integration id under which an organization stores its key for an AI provider (`openai` → `ai_openai`). */
export function aiProviderIntegrationId(providerId: string): string {
  return `ai_${providerId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
}

export type IntegrationCredentialSource = 'customer' | 'platform'

export type IntegrationCredentialFallbackPolicy = 'disabled' | 'platform'

export const INTEGRATION_CREDENTIAL_ERROR_CODES = [
  'tenant_context_missing',
  'provider_unsupported',
  'integration_disabled',
  'integration_not_configured',
  'platform_fallback_prohibited',
  'credential_unreadable',
  'platform_credential_unavailable',
  'usage_recording_failed',
  'resolver_unavailable',
] as const

export type IntegrationCredentialErrorCode = (typeof INTEGRATION_CREDENTIAL_ERROR_CODES)[number]

const ERROR_NAME = 'IntegrationCredentialError'

const DEFAULT_ERROR_MESSAGES: Record<IntegrationCredentialErrorCode, string> = {
  tenant_context_missing: 'A tenant and organization are required to resolve integration credentials',
  provider_unsupported: 'The integration does not support organization credentials',
  integration_disabled: 'The integration is disabled for this organization',
  integration_not_configured: 'The organization has not configured credentials for this service',
  platform_fallback_prohibited: 'Platform credentials are not permitted for this service',
  credential_unreadable: 'Stored integration credentials could not be read',
  platform_credential_unavailable: 'The platform credential for this service is not configured',
  usage_recording_failed: 'Platform credential usage could not be recorded',
  resolver_unavailable: 'The integration credential resolver is not registered',
}

const ERROR_STATUS: Record<IntegrationCredentialErrorCode, number> = {
  tenant_context_missing: 400,
  provider_unsupported: 400,
  integration_disabled: 409,
  integration_not_configured: 409,
  platform_fallback_prohibited: 409,
  credential_unreadable: 503,
  platform_credential_unavailable: 503,
  usage_recording_failed: 503,
  resolver_unavailable: 503,
}

export type IntegrationCredentialErrorDetails = {
  integrationId?: string | null
  service?: IntegrationCredentialService | null
  message?: string
  cause?: unknown
}

export class IntegrationCredentialError extends Error {
  readonly code: IntegrationCredentialErrorCode
  readonly integrationId: string | null
  readonly service: IntegrationCredentialService | null
  readonly status: number

  constructor(code: IntegrationCredentialErrorCode, details: IntegrationCredentialErrorDetails = {}) {
    super(details.message ?? DEFAULT_ERROR_MESSAGES[code], details.cause === undefined ? undefined : { cause: details.cause })
    this.name = ERROR_NAME
    this.code = code
    this.integrationId = details.integrationId ?? null
    this.service = details.service ?? null
    this.status = ERROR_STATUS[code]
  }
}

function isErrorCode(value: unknown): value is IntegrationCredentialErrorCode {
  return typeof value === 'string' && (INTEGRATION_CREDENTIAL_ERROR_CODES as readonly string[]).includes(value)
}

/**
 * Structural guard: an API route and the service that threw can hold different copies of this
 * class when the bundler splits chunks, so `instanceof` is not reliable across modules.
 */
export function isIntegrationCredentialError(error: unknown): error is IntegrationCredentialError {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === ERROR_NAME && isErrorCode(candidate.code)
}

/**
 * True for errors the organization has to fix (missing, disabled or prohibited credentials,
 * missing scope). Background jobs should not retry these; system failures (unreadable
 * storage, missing platform key, usage recording) stay retryable.
 */
export function isPermanentIntegrationCredentialError(error: unknown): error is IntegrationCredentialError {
  return isIntegrationCredentialError(error) && ERROR_STATUS[error.code] < 500
}

export function resolveIntegrationCredentialErrorStatus(code: IntegrationCredentialErrorCode): number {
  return ERROR_STATUS[code]
}

type TranslateFn = (key: string, fallback?: string, params?: Record<string, string | number>) => string

function resolveErrorMessageKey(error: IntegrationCredentialError): { key: string; fallback: string } {
  switch (error.code) {
    case 'integration_not_configured':
      if (error.service === 'email') {
        return {
          key: 'integrations.credentials.errors.notConfigured.email',
          fallback: 'Email delivery is not configured for this organization. Add a Resend API key in Integrations.',
        }
      }
      if (error.service === 'ai') {
        return {
          key: 'integrations.credentials.errors.notConfigured.ai',
          fallback: 'No AI provider is configured for this organization. Add an AI provider key in Integrations.',
        }
      }
      return {
        key: 'integrations.credentials.errors.notConfigured.generic',
        fallback: 'This integration is not configured for this organization. Configure it in Integrations.',
      }
    case 'integration_disabled':
      return {
        key: 'integrations.credentials.errors.disabled',
        fallback: 'This integration is disabled for this organization. Enable it in Integrations.',
      }
    case 'platform_fallback_prohibited':
      return {
        key: 'integrations.credentials.errors.platformUseProhibited',
        fallback: 'This feature runs on platform credentials, which are not enabled for this organization.',
      }
    case 'tenant_context_missing':
      return {
        key: 'integrations.credentials.errors.organizationRequired',
        fallback: 'Select an organization to use this feature.',
      }
    case 'provider_unsupported':
      return {
        key: 'integrations.credentials.errors.unsupported',
        fallback: 'This integration does not support organization credentials.',
      }
    default:
      return {
        key: 'integrations.credentials.errors.unavailable',
        fallback: 'Integration credentials are temporarily unavailable. Try again later.',
      }
  }
}

export function integrationCredentialErrorResponse(error: IntegrationCredentialError, translate: TranslateFn): Response {
  return Response.json(buildIntegrationCredentialErrorBody(error, translate), { status: error.status })
}

export function buildIntegrationCredentialErrorBody(
  error: IntegrationCredentialError,
  translate: TranslateFn,
): { error: string; code: IntegrationCredentialErrorCode } {
  const { key, fallback } = resolveErrorMessageKey(error)
  return { error: translate(key, fallback), code: error.code }
}

const REDACTED = '[redacted]'
const INSPECT_SYMBOL = Symbol.for('nodejs.util.inspect.custom')

export type IntegrationSecret = {
  reveal(): string
  toString(): string
  toJSON(): string
}

/**
 * Holds a credential so that logging, string interpolation, `JSON.stringify` and
 * `util.inspect` all print `[redacted]`. Only `reveal()`, called at the provider call site,
 * returns the value.
 */
export function createIntegrationSecret(value: string): IntegrationSecret {
  return Object.freeze({
    reveal: () => value,
    toString: () => REDACTED,
    toJSON: () => REDACTED,
    [INSPECT_SYMBOL]: () => REDACTED,
  })
}

export type IntegrationCredentialScopeInput = {
  tenantId?: string | null
  organizationId?: string | null
}

export type IntegrationCredentialRequest = {
  integrationId: string
  scope: IntegrationCredentialScopeInput
  operation: string
  correlationId?: string | null
}

export type IntegrationServiceCredentialRequest = {
  service: IntegrationCredentialService
  scope: IntegrationCredentialScopeInput
  operation: string
  correlationId?: string | null
}

export type ResolvedIntegrationCredential = {
  readonly integrationId: string
  readonly service: IntegrationCredentialService
  readonly source: IntegrationCredentialSource
  readonly tenantId: string
  readonly organizationId: string
  readonly requiresUsageAttribution: boolean
  readonly secret: IntegrationSecret
  readonly settings: Readonly<Record<string, string>>
}

export type ResolvedServiceCredentials = {
  readonly service: IntegrationCredentialService
  readonly source: IntegrationCredentialSource
  readonly tenantId: string
  readonly organizationId: string
  readonly credentials: readonly ResolvedIntegrationCredential[]
  markUsed(integrationId: string): Promise<void>
}

export type IntegrationServiceStatus = {
  readonly service: IntegrationCredentialService
  readonly configured: boolean
  readonly source: IntegrationCredentialSource | null
  readonly integrationIds: readonly string[]
  readonly platformFallbackAllowed: boolean
}

export interface IntegrationCredentialResolver {
  resolve(request: IntegrationCredentialRequest): Promise<ResolvedIntegrationCredential>
  resolveService(request: IntegrationServiceCredentialRequest): Promise<ResolvedServiceCredentials>
  authorizePlatformUse(request: IntegrationCredentialRequest): Promise<void>
  getServiceStatus(input: {
    service: IntegrationCredentialService
    scope: IntegrationCredentialScopeInput
  }): Promise<IntegrationServiceStatus>
}

type ResolverLookup = {
  resolve: <T = unknown>(name: string) => T
  hasRegistration?: (name: string) => boolean
}

export function resolveIntegrationCredentialResolver(container: ResolverLookup): IntegrationCredentialResolver | null {
  if (typeof container.hasRegistration === 'function') {
    return container.hasRegistration(INTEGRATION_CREDENTIAL_RESOLVER_KEY)
      ? container.resolve<IntegrationCredentialResolver>(INTEGRATION_CREDENTIAL_RESOLVER_KEY)
      : null
  }
  try {
    return container.resolve<IntegrationCredentialResolver>(INTEGRATION_CREDENTIAL_RESOLVER_KEY)
  } catch {
    return null
  }
}

export function requireIntegrationCredentialResolver(container: ResolverLookup): IntegrationCredentialResolver {
  const resolver = resolveIntegrationCredentialResolver(container)
  if (!resolver) {
    throw new IntegrationCredentialError('resolver_unavailable')
  }
  return resolver
}
