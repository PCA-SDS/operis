import type { AwilixContainer } from 'awilix'
import type { IntegrationStateService } from './state-service'
import type { IntegrationLogService } from './log-service'
import {
  getIntegration,
  getBundle,
  type IntegrationScope,
  type IntegrationHealthCheckConfig,
} from '@open-mercato/shared/modules/integrations/types'

export const HEALTH_CHECK_TIMEOUT_MS = 10_000

export type IntegrationHealthDisplayStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured'

export type HealthCheckRunResult = {
  status: IntegrationHealthDisplayStatus
  message?: string
  details?: Record<string, unknown>
  latencyMs: number | null
  checkedAt: string
}

type ProbeHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

type HealthCheckResult = {
  status: ProbeHealthStatus
  message?: string
  details?: Record<string, unknown>
}

type HealthCheckService = {
  check: (credentials: Record<string, unknown> | null, scope: IntegrationScope) => Promise<HealthCheckResult>
}

export function getEffectiveHealthCheckConfig(integrationId: string): IntegrationHealthCheckConfig | undefined {
  const definition = getIntegration(integrationId)
  if (!definition) return undefined
  return definition.healthCheck ?? (definition.bundleId ? getBundle(definition.bundleId)?.healthCheck : undefined)
}

function isCredentialsEmpty(credentials: Record<string, unknown> | null): boolean {
  if (credentials == null) return true
  return Object.keys(credentials).length === 0
}

function normalizeProbeResult(raw: HealthCheckResult): HealthCheckResult {
  if (raw.status === 'healthy' || raw.status === 'degraded' || raw.status === 'unhealthy') {
    return raw
  }
  return { status: 'unhealthy', message: raw.message ?? 'Invalid health status', details: raw.details }
}

const REDACTED = '[redacted]'
const MIN_REDACTED_VALUE_LENGTH = 8

function collectRedactionCandidates(credentials: Record<string, unknown>): string[] {
  return Object.values(credentials)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length >= MIN_REDACTED_VALUE_LENGTH)
}

function redactText(text: string, candidates: string[]): string {
  return candidates.reduce((current, candidate) => current.split(candidate).join(REDACTED), text)
}

function redactValue(value: unknown, candidates: string[]): unknown {
  if (typeof value === 'string') return redactText(value, candidates)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, candidates))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, candidates)]))
  }
  return value
}

function redactProbeResult(result: HealthCheckResult, credentials: Record<string, unknown>): HealthCheckResult {
  const candidates = collectRedactionCandidates(credentials)
  if (candidates.length === 0) return result
  return {
    status: result.status,
    ...(result.message !== undefined ? { message: redactText(result.message, candidates) } : {}),
    ...(result.details !== undefined ? { details: redactValue(result.details, candidates) as Record<string, unknown> } : {}),
  }
}

async function runProbeWithTimeout(
  checker: HealthCheckService,
  credentials: Record<string, unknown>,
  scope: IntegrationScope,
): Promise<HealthCheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Health check timed out'))
    }, HEALTH_CHECK_TIMEOUT_MS)
  })
  try {
    return await Promise.race([checker.check(credentials, scope), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function deriveIntegrationHealthStatus(input: {
  hasHealthCheck: boolean
  hasCredentials: boolean
  lastHealthStatus: string | null
  lastHealthCheckedAt: Date | null
}): IntegrationHealthDisplayStatus {
  if (!input.hasHealthCheck || !input.hasCredentials) {
    return 'unconfigured'
  }
  if (
    input.lastHealthStatus === 'healthy'
    || input.lastHealthStatus === 'degraded'
    || input.lastHealthStatus === 'unhealthy'
  ) {
    return input.lastHealthStatus
  }
  return 'unconfigured'
}

export function createHealthService(
  container: AwilixContainer,
  stateService: IntegrationStateService,
  logService: IntegrationLogService,
) {
  async function probe(
    serviceName: string,
    credentials: Record<string, unknown>,
    scope: IntegrationScope,
  ): Promise<{ result: HealthCheckResult; latencyMs: number }> {
    const startedAt = Date.now()
    let result: HealthCheckResult
    try {
      const checker = container.resolve<HealthCheckService>(serviceName)
      result = normalizeProbeResult(await runProbeWithTimeout(checker, credentials, scope))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Health check failed'
      result = { status: 'unhealthy', message }
    }
    return { result: redactProbeResult(result, credentials), latencyMs: Date.now() - startedAt }
  }

  return {
    /**
     * Probes credentials the caller has not saved. Nothing is persisted: no credentials, no
     * health state and no log entry, so testing a key never changes what the organization uses.
     */
    async testCredentials(
      integrationId: string,
      credentials: Record<string, unknown>,
      scope: IntegrationScope,
    ): Promise<HealthCheckRunResult> {
      const checkedAt = new Date().toISOString()
      const healthConfig = getEffectiveHealthCheckConfig(integrationId)
      if (!healthConfig?.service) {
        return { status: 'unconfigured', message: 'No health check configured', latencyMs: null, checkedAt }
      }
      if (isCredentialsEmpty(credentials)) {
        return { status: 'unconfigured', message: 'No credentials configured', latencyMs: null, checkedAt }
      }
      const { result, latencyMs } = await probe(healthConfig.service, credentials, scope)
      return {
        status: result.status,
        message: result.message,
        details: result.details,
        latencyMs,
        checkedAt: new Date().toISOString(),
      }
    },

    async runHealthCheck(integrationId: string, scope: IntegrationScope): Promise<HealthCheckRunResult> {
      const checkedAt = new Date().toISOString()
      const healthConfig = getEffectiveHealthCheckConfig(integrationId)

      if (!healthConfig?.service) {
        return {
          status: 'unconfigured',
          message: 'No health check configured',
          latencyMs: null,
          checkedAt,
        }
      }

      const credentialsService = container.resolve<{
        resolve: (id: string, scope: IntegrationScope) => Promise<Record<string, unknown> | null>
      }>('integrationCredentialsService')
      const credentials = await credentialsService.resolve(integrationId, scope)

      if (isCredentialsEmpty(credentials)) {
        return {
          status: 'unconfigured',
          message: 'No credentials configured',
          latencyMs: null,
          checkedAt,
        }
      }

      const { result, latencyMs } = await probe(healthConfig.service, credentials ?? {}, scope)

      await stateService.upsert(
        integrationId,
        {
          lastHealthStatus: result.status,
          lastHealthCheckedAt: new Date(),
          lastHealthLatencyMs: latencyMs,
        },
        scope,
      )

      const logger = logService.scoped(integrationId, scope)
      if (result.status === 'healthy') {
        await logger.info('Health check passed', { status: result.status, ...result.details })
      } else {
        await logger.warn(`Health check: ${result.status}`, {
          status: result.status,
          message: result.message,
          ...result.details,
        })
      }

      return {
        status: result.status,
        message: result.message,
        details: result.details,
        latencyMs,
        checkedAt: new Date().toISOString(),
      }
    },
  }
}

export type IntegrationHealthService = ReturnType<typeof createHealthService>
