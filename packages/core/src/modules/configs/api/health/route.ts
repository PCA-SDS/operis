import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { configsTag } from '../openapi'

const logger = createLogger('configs').child({ component: 'health' })

/**
 * Unauthenticated liveness/readiness probe.
 *
 * Deliberately coarse: it answers "is this process up and can it reach its
 * database", which is what a load balancer, a container healthcheck, and a
 * developer verifying a fresh clone each need. It exposes no version, no
 * configuration and no error detail — the authenticated
 * `/api/configs/system-status` endpoint is where that belongs, because an
 * unauthenticated probe is reachable by anyone who can reach the port.
 */
export const metadata = {
  GET: { requireAuth: false },
} as const

type CheckResult = { ok: boolean }

async function checkDatabase(): Promise<CheckResult> {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    await em.getConnection().execute('select 1')
    return { ok: true }
  } catch (err) {
    // Logged server-side so an operator can diagnose; never returned to the caller.
    logger.error('Health check could not reach the database', { err })
    return { ok: false }
  }
}

export async function GET() {
  const database = await checkDatabase()
  const ok = database.ok
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', checks: { database } },
    { status: ok ? 200 : 503 },
  )
}

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.object({ ok: z.boolean() }),
  }),
})

export const openApi: OpenApiRouteDoc = {
  tag: configsTag,
  summary: 'Service health',
  methods: {
    GET: {
      summary: 'Liveness and readiness probe',
      description: 'Unauthenticated probe reporting whether the application is running and can reach its database. Returns 503 when a mandatory dependency is unavailable.',
      responses: [
        { status: 200, description: 'Service healthy', schema: healthResponseSchema },
      ],
      errors: [
        { status: 503, description: 'A mandatory dependency is unavailable', schema: healthResponseSchema },
      ],
    },
  },
}
