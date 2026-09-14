import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  extractHomeserverToken,
  matrixConfigFromEnv,
  parseTransaction,
  verifyHomeserverToken,
} from '@open-mercato/matrix'
import { resolveChatTransportId } from '@open-mercato/core/modules/chat/lib/transport'
import { ChatMatrixTransaction } from '../../../../../../../data/entities'
import { enqueueAppserviceTransaction } from '../../../../../../../lib/queue'

const logger = createLogger('chat_matrix').child({ component: 'appservice' })

/**
 * The homeserver's own endpoint, and the only unauthenticated surface this
 * module has.
 *
 * The path is not a choice. A registration's `url` is the appservice's BASE
 * address and the homeserver appends the spec path to it, so Synapse PUTs to
 * `<base>/_matrix/app/v1/transactions/{txnId}` — set the base to the
 * transactions path itself and every push 404s at a URL with the segment twice
 * in it, which is exactly what happened the first time.
 *
 * `requireAuth: false` because Synapse holds no Operis session — it presents the
 * `hs_token` from the registration, which is a shared secret generated at the
 * same time as the `as_token` and never leaves the deployment. That token is the
 * entire security boundary, so it is compared in constant time and checked
 * before the body is read.
 */
export const metadata = {
  PUT: { requireAuth: false },
}

const paramsSchema = z.object({ txnId: z.string().min(1).max(255) })

/** Synapse expects `{}` and treats any non-2xx as "retry this same payload". */
const ACK = { status: 200, headers: { 'content-type': 'application/json' } } as const
const ack = () => new Response('{}', ACK)

/**
 * Accept one pushed transaction.
 *
 * **Nothing is projected here.** Synapse blocks on this response and holds every
 * later transaction behind it — up to 60s per request — so the work happens in a
 * worker and this returns as soon as the transaction is durably recorded. That
 * split is the difference between a slow room and a stalled one.
 *
 * **A duplicate is a success, not a conflict.** Synapse retries a transaction it
 * did not see acknowledged, so the same `txn_id` arriving twice means the first
 * 200 was lost, not that anything is wrong. `chat_matrix_txns_txn_uq` is what
 * makes that a database fact rather than a race between two app instances.
 *
 * **Every refusal returns the same shape.** A bad token, an unconfigured
 * deployment and a malformed body are all `403 {"errcode":"M_FORBIDDEN"}` or a
 * plain 400 — nothing here tells an unauthenticated caller whether the token was
 * close, whether the transport is on, or whether a room exists.
 */
export async function PUT(req: Request, context: { params?: Record<string, unknown> }) {
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) return forbidden()
  const { txnId } = parsedParams.data

  /**
   * Refuse before anything else when this deployment does not run the
   * transport, or has no `hs_token` to check against.
   *
   * An endpoint that cannot authenticate must not accept: without a configured
   * token `verifyHomeserverToken` would compare against an empty string, and an
   * empty expected secret is one an attacker can present.
   */
  const config = matrixConfigFromEnv()
  if (!config?.hsToken || resolveChatTransportId() !== 'matrix') return forbidden()

  const presented = extractHomeserverToken(req.headers)
  if (!verifyHomeserverToken(presented, config.hsToken)) {
    logger.warn('rejected an appservice transaction with a bad token', { txnId })
    return forbidden()
  }

  const body = await readJsonSafe(req, null)
  const transaction = parseTransaction(body)
  if (!transaction) {
    // A body Synapse could not have produced. 400 rather than 403 so an
    // operator reading logs can tell a broken sender from a hostile one — and
    // it is only reachable by something already holding the token.
    logger.warn('rejected an unparseable appservice transaction', { txnId })
    return new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } })
  }

  try {
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    em.persist(
      em.create(ChatMatrixTransaction, {
        txnId,
        eventCount: transaction.receivedCount,
        receivedAt: new Date(),
        processedAt: null,
      }),
    )
    try {
      await em.flush()
    } catch (error) {
      // Already seen it. Acknowledge without enqueuing a second copy — the
      // first one is either in flight or long since applied.
      if (isUniqueViolation(error)) return ack()
      throw error
    }

    await enqueueAppserviceTransaction({
      txnId,
      events: (body as unknown as { events?: unknown[] } | null)?.events ?? [],
      ephemeral: transaction.ephemeral,
    })

    logger.debug('accepted an appservice transaction', {
      txnId,
      events: transaction.receivedCount,
      ephemeral: transaction.ephemeral.length,
    })
    return ack()
  } catch (error) {
    /**
     * 500, so Synapse retries.
     *
     * The alternative — acknowledging what we failed to record — loses the
     * transaction permanently, because an appservice transaction has no cursor
     * to rediscover it with. A retry costs a duplicate the unique constraint
     * absorbs.
     */
    logger.error('could not accept an appservice transaction', {
      txnId,
      error: error instanceof Error ? error.message : String(error),
    })
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
  }
}

function forbidden(): Response {
  return new Response(JSON.stringify({ errcode: 'M_FORBIDDEN' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Chat Matrix',
  summary: 'Appservice transactions',
  methods: {
    PUT: {
      summary: 'Accept a transaction pushed by the homeserver',
      description:
        'Called by Synapse, never by a browser. Authenticated with the registration’s hs_token and acknowledged before any projection happens, because the homeserver holds every later transaction behind this response.',
      responses: [{ status: 200, description: 'Accepted.' }],
      errors: [
        { status: 400, description: 'The body is not a transaction.' },
        { status: 403, description: 'Bad or missing hs_token, or the transport is not configured.' },
        { status: 500, description: 'Not recorded — the homeserver should retry.' },
      ],
    },
  },
}
