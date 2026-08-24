import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_FALLBACK_KEY,
} from '@open-mercato/shared/lib/ratelimit/helpers'

/**
 * Four independent limiters, because they defend against different things:
 *
 *  - `auth`   — brute force against the token/authorize endpoints, keyed by IP.
 *  - `session` — a single compromised OAuth session hammering the endpoint,
 *                keyed by token id so it cannot be spread across IPs.
 *  - `mutation` — the tight one. An attacker with a valid write token should not
 *                be able to rewrite the tenant's task board before anyone reacts.
 *  - `ip`     — coarse backstop for unauthenticated traffic.
 */
const authRateLimit = readEndpointRateLimitConfig('MCP_AUTH', {
  points: 10,
  duration: 60,
  blockDuration: 300,
  keyPrefix: 'mcp-auth',
})

const sessionRateLimit = readEndpointRateLimitConfig('MCP_SESSION', {
  points: 120,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'mcp-session',
})

const mutationRateLimit = readEndpointRateLimitConfig('MCP_MUTATION', {
  points: 30,
  duration: 60,
  blockDuration: 120,
  keyPrefix: 'mcp-mutation',
})

const ipRateLimit = readEndpointRateLimitConfig('MCP_IP', {
  points: 240,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'mcp-ip',
})

type RateLimiterService = Awaited<
  ReturnType<typeof import('@open-mercato/core/bootstrap').getCachedRateLimiterService>
>

/**
 * Resolved lazily. `@open-mercato/core/bootstrap` pulls in the whole runtime
 * graph (search drivers included), and importing that eagerly would drag it into
 * every module that merely wants to rate-limit something.
 */
async function resolveRateLimiterService(): Promise<RateLimiterService> {
  const { getCachedRateLimiterService } = await import('@open-mercato/core/bootstrap')
  return getCachedRateLimiterService()
}

type LimiterKind = 'auth' | 'session' | 'mutation' | 'ip'

const CONFIGS = {
  auth: authRateLimit,
  session: sessionRateLimit,
  mutation: mutationRateLimit,
  ip: ipRateLimit,
} as const

/**
 * Returns a 429/503 response when the caller is over budget, else null.
 *
 * Mutation and auth limiters fail *closed*: if the limiter's backing store is
 * unreachable we would rather reject than let an unbounded number of writes or
 * credential guesses through uncounted.
 */
export async function enforceMcpRateLimit(
  kind: LimiterKind,
  identifier: string,
): Promise<Response | null> {
  const service = await resolveRateLimiterService()
  if (!service) return null

  return checkRateLimit(
    service,
    CONFIGS[kind],
    identifier || RATE_LIMIT_FALLBACK_KEY,
    RATE_LIMIT_ERROR_FALLBACK,
    { failClosed: kind === 'mutation' || kind === 'auth' },
  )
}

export async function resolveClientIpForMcp(req: Request): Promise<string> {
  const service = await resolveRateLimiterService()
  return getClientIp(req, service?.trustProxyDepth ?? 0) ?? RATE_LIMIT_FALLBACK_KEY
}
