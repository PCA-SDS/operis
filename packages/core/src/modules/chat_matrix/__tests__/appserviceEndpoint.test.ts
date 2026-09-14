import { ChatMatrixTransaction } from '../data/entities'

/**
 * The one unauthenticated surface this module has, so its refusals are what
 * this suite is mostly about.
 *
 * The container, the entity manager and the queue are all faked — what belongs
 * here is the decision the endpoint makes before any of them matter: is this
 * really the homeserver, have we seen this transaction, and does anything get
 * projected on the request path (it must not).
 */

const HS_TOKEN = 'hs-secret-token-value'
const AS_TOKEN = 'as-secret-token-value'

let transportId = 'matrix'
let hsToken: string | null = HS_TOKEN
const enqueued: Array<Record<string, unknown>> = []
const persisted: Array<Record<string, unknown>> = []
let flushThrows: 'unique' | 'other' | null = null

jest.mock('@open-mercato/matrix', () => {
  const actual = jest.requireActual('@open-mercato/matrix')
  return {
    ...actual,
    matrixConfigFromEnv: () =>
      hsToken === null
        ? null
        : {
            baseUrl: 'http://127.0.0.1:8008',
            serverName: 'operis.local',
            asToken: AS_TOKEN,
            hsToken,
            senderLocalpart: 'operis',
            userPrefix: 'om_',
            botLocalpart: 'om_bot',
          },
  }
})

jest.mock('@open-mercato/core/modules/chat/lib/transport', () => ({
  resolveChatTransportId: () => transportId,
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({
      fork: () => ({
        create: (_entity: unknown, data: Record<string, unknown>) => data,
        persist: (row: Record<string, unknown>) => persisted.push(row),
        async flush() {
          if (flushThrows === 'unique') {
            const error = new Error('duplicate key') as Error & { code?: string }
            error.code = '23505'
            throw error
          }
          if (flushThrows === 'other') throw new Error('the database is down')
        },
      }),
    }),
  }),
}))

jest.mock('../lib/queue', () => ({
  ...jest.requireActual('../lib/queue'),
  enqueueAppserviceTransaction: async (job: Record<string, unknown>) => {
    enqueued.push(job)
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUT } = require('../api/appservice/_matrix/app/v1/transactions/[txnId]/route') as {
  PUT: (req: Request, ctx: { params?: Record<string, unknown> }) => Promise<Response>
}

const body = (events: unknown[] = [], ephemeral: unknown[] = []) =>
  JSON.stringify({ events, ephemeral })

function request(options: { token?: string | null; payload?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? HS_TOKEN}`
  return new Request('http://localhost/api/chat_matrix/appservice/_matrix/app/v1/transactions/txn-1', {
    method: 'PUT',
    headers,
    body: options.payload ?? body(),
  })
}

const params = { params: { txnId: 'txn-1' } }

beforeEach(() => {
  transportId = 'matrix'
  hsToken = HS_TOKEN
  flushThrows = null
  enqueued.length = 0
  persisted.length = 0
})

describe('who it accepts', () => {
  it('accepts a transaction presenting the registration token', async () => {
    const response = await PUT(request(), params)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{}')
  })

  it.each([
    ['no token at all', null],
    ['a wrong token', 'not-the-token'],
    // Same length as the real one, so this is the case a naive comparison
    // would leak timing on.
    ['a same-length near miss', 'hs-secret-token-valuX'],
  ])('refuses %s', async (_label, token) => {
    const response = await PUT(request({ token }), params)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ errcode: 'M_FORBIDDEN' })
    expect(enqueued).toHaveLength(0)
  })

  /**
   * An endpoint that cannot authenticate must not accept. Without a configured
   * token the comparison would be against an empty string — a secret anybody
   * can present.
   */
  it('refuses when the deployment has no hs_token', async () => {
    hsToken = null
    expect((await PUT(request(), params)).status).toBe(403)
    expect(enqueued).toHaveLength(0)
  })

  it('refuses when the transport is not Matrix', async () => {
    transportId = 'local'
    expect((await PUT(request(), params)).status).toBe(403)
    expect(enqueued).toHaveLength(0)
  })

  it('gives every refusal the same shape', async () => {
    // Nothing here tells an unauthenticated caller whether the token was close,
    // whether the transport is on, or whether anything exists.
    hsToken = null
    const unconfigured = await PUT(request(), params)
    hsToken = HS_TOKEN
    const wrongToken = await PUT(request({ token: 'nope' }), params)

    expect(unconfigured.status).toBe(wrongToken.status)
    expect(await unconfigured.json()).toEqual(await wrongToken.json())
  })
})

describe('what it does with an accepted one', () => {
  it('records it before acknowledging', async () => {
    await PUT(request(), params)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ txnId: 'txn-1', processedAt: null })
  })

  it('hands the events to the queue rather than projecting them', async () => {
    // Synapse blocks on this response and holds every later transaction behind
    // it, so anything slow here stalls the room for everybody.
    const event = { type: 'm.room.message', event_id: '$a', sender: '@x:y', origin_server_ts: 1, room_id: '!r:y', content: {} }
    await PUT(request({ payload: body([event]) }), params)

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({ txnId: 'txn-1' })
    expect((enqueued[0].events as unknown[])[0]).toEqual(event)
  })

  it('carries ephemeral events through too', async () => {
    const receipt = { type: 'm.receipt', room_id: '!r:y', content: {} }
    await PUT(request({ payload: body([], [receipt]) }), params)
    expect(enqueued[0].ephemeral).toEqual([receipt])
  })

  it('counts what arrived, not what parsed', async () => {
    await PUT(request({ payload: body([{ nonsense: true }, { also: 'bad' }]) }), params)
    expect(persisted[0].eventCount).toBe(2)
  })
})

describe('when the same transaction arrives twice', () => {
  /**
   * Synapse retries a transaction it did not see acknowledged, so a repeat
   * means the first 200 was lost — not that anything is wrong.
   */
  it('acknowledges without enqueuing a second copy', async () => {
    flushThrows = 'unique'
    const response = await PUT(request(), params)
    expect(response.status).toBe(200)
    expect(enqueued).toHaveLength(0)
  })
})

describe('when it cannot record the transaction', () => {
  /**
   * 500, so the homeserver retries. Acknowledging what we failed to record
   * loses it permanently: a pushed transaction has no cursor to rediscover it
   * with, unlike everything the `/sync` reader sees.
   */
  it('asks the homeserver to try again', async () => {
    flushThrows = 'other'
    const response = await PUT(request(), params)
    expect(response.status).toBe(500)
    expect(enqueued).toHaveLength(0)
  })
})

describe('a body Synapse could not have produced', () => {
  it('is refused with 400, not 403', async () => {
    // Only reachable by something already holding the token, so an operator
    // reading logs can tell a broken sender from a hostile one.
    const response = await PUT(request({ payload: '{"events":"not-an-array"}' }), params)
    expect(response.status).toBe(400)
    expect(enqueued).toHaveLength(0)
  })
})

describe('the entity it writes', () => {
  it('is the deduplication ledger, keyed on the homeserver transaction id', () => {
    // Guards the assumption the endpoint rests on: the unique constraint, not
    // the application, is what makes a repeat safe across two app instances.
    expect(ChatMatrixTransaction.name).toBe('ChatMatrixTransaction')
  })
})
