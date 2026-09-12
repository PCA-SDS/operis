import { MatrixClient } from '../client'
import { resolveMatrixConfig } from '../config'
import { MatrixError, MatrixNamespaceError } from '../errors'

const config = resolveMatrixConfig({
  homeserverUrl: 'http://127.0.0.1:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
})

const USER = '@om_u_64097a24ecb4479580c2bb466858f186:operis.local'

type Call = { url: URL; init: RequestInit }

let calls: Call[] = []
const originalFetch = global.fetch

function mockFetch(responses: Array<() => Response | Promise<Response>>) {
  let index = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} })
    const next = responses[Math.min(index, responses.length - 1)]
    index += 1
    return next()
  }) as unknown as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  calls = []
  jest.useRealTimers()
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('authentication and masquerade', () => {
  it('sends the token as a header, never in the query string', async () => {
    mockFetch([() => json({ user_id: '@operis:operis.local' })])
    await new MatrixClient(config).whoami()

    const [call] = calls
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Bearer ${config.asToken}`)
    // A token in a URL is a token in every access log along the way.
    expect(call.url.search).not.toContain(config.asToken)
  })

  it('passes the impersonated user as user_id', async () => {
    mockFetch([() => json({ event_id: '$e' })])
    await new MatrixClient(config).sendEvent({
      roomId: '!r:operis.local',
      eventType: 'm.room.message',
      transactionId: 'om-1',
      content: { body: 'x' },
      asUser: USER,
    })
    expect(calls[0].url.searchParams.get('user_id')).toBe(USER)
  })

  it('refuses to act outside the namespace before making any request', async () => {
    mockFetch([() => json({})])
    const client = new MatrixClient(config)

    await expect(
      client.sendEvent({
        roomId: '!r:operis.local',
        eventType: 'm.room.message',
        transactionId: 'om-1',
        content: {},
        asUser: '@alice:operis.local',
      }),
    ).rejects.toThrow(MatrixNamespaceError)

    // The gate must fail closed, not fail late — nothing should have left the process.
    expect(calls).toHaveLength(0)
  })
})

describe('transport hardening', () => {
  it('refuses to follow a redirect', async () => {
    mockFetch([() => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })])
    await expect(new MatrixClient(config).whoami()).rejects.toThrow(/redirect/)
  })

  it('sets redirect: manual so fetch cannot follow one for us', async () => {
    mockFetch([() => json({ user_id: '@operis:operis.local' })])
    await new MatrixClient(config).whoami()
    expect(calls[0].init.redirect).toBe('manual')
  })

  it('rejects a response whose declared length exceeds the ceiling', async () => {
    mockFetch([
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(64 * 1024 * 1024) },
        }),
    ])
    await expect(new MatrixClient(config).whoami()).rejects.toThrow(/maximum accepted size/)
  })

  it('classifies a network failure as transient, with status 0', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    // Asserted on a non-retrying call deliberately. `whoami` retries with the
    // real 500/2000/5000ms backoff, which is correct behaviour but takes longer
    // than jest's default timeout — the classification is what is under test
    // here, not the schedule.
    await expect(
      new MatrixClient(config).setTyping('!r:operis.local', USER, true),
    ).rejects.toMatchObject({ kind: 'transient', status: 0 })
  })
})

describe('error classification', () => {
  it('surfaces a permanent failure without retrying', async () => {
    mockFetch([() => json({ errcode: 'M_FORBIDDEN', error: 'nope' }, 403)])
    await expect(new MatrixClient(config).whoami()).rejects.toMatchObject({
      kind: 'permanent',
      status: 403,
      errcode: 'M_FORBIDDEN',
    })
    expect(calls).toHaveLength(1)
  })

  it('surfaces an expired token as reauth', async () => {
    mockFetch([() => json({ errcode: 'M_UNKNOWN_TOKEN', error: 'gone' }, 401)])
    await expect(new MatrixClient(config).whoami()).rejects.toMatchObject({ kind: 'reauth' })
  })

  it('reads retry_after_ms off a 429 body', async () => {
    mockFetch([() => json({ errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 25 }, 429)])
    // Retry is on for whoami, so it will exhaust attempts; the final error still
    // carries the server's own backoff hint.
    await expect(new MatrixClient(config).whoami()).rejects.toMatchObject({
      kind: 'transient',
      retryAfterMs: 25,
    })
  })
})

describe('retry policy', () => {
  it('retries a transient failure on a retryable call and then succeeds', async () => {
    mockFetch([
      () => json({ errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 1 }, 429),
      () => json({ user_id: '@operis:operis.local' }),
    ])
    await expect(new MatrixClient(config).whoami()).resolves.toEqual({
      user_id: '@operis:operis.local',
    })
    expect(calls).toHaveLength(2)
  })

  it('does NOT retry createRoom', async () => {
    // Not idempotent: a retry after a timeout leaves two rooms behind for one
    // conversation, and the caller cannot tell them apart afterwards.
    mockFetch([() => json({ errcode: 'M_UNKNOWN', error: 'boom' }, 500)])
    await expect(
      new MatrixClient(config).createRoom({ name: 'x' }, USER),
    ).rejects.toMatchObject({ kind: 'transient' })
    expect(calls).toHaveLength(1)
  })

  it('does NOT retry a typing notification', async () => {
    // A typing hint has a short lifetime; replaying a stale one is worse than
    // dropping it.
    mockFetch([() => json({}, 500)])
    await expect(new MatrixClient(config).setTyping('!r:operis.local', USER, true)).rejects.toThrow(
      MatrixError,
    )
    expect(calls).toHaveLength(1)
  })
})

describe('registerUser', () => {
  it('treats an already-registered user as success', async () => {
    // Makes it safe to call unconditionally, which is simpler and cheaper than
    // tracking who has been registered.
    mockFetch([() => json({ errcode: 'M_USER_IN_USE', error: 'taken' }, 400)])
    await expect(new MatrixClient(config).registerUser('om_u_abc')).resolves.toBeUndefined()
  })

  it('propagates any other failure', async () => {
    mockFetch([() => json({ errcode: 'M_FORBIDDEN', error: 'no' }, 403)])
    await expect(new MatrixClient(config).registerUser('om_u_abc')).rejects.toThrow(MatrixError)
  })
})

describe('reading', () => {
  it('drops a malformed event from a timeline page instead of failing the page', async () => {
    mockFetch([
      () =>
        json({
          chunk: [
            { type: 'm.room.message', event_id: '$a', sender: '@om_bot:operis.local', origin_server_ts: 1, content: {} },
            { garbage: true },
          ],
          start: 't1',
          end: 't2',
        }),
    ])
    const page = await new MatrixClient(config).messages('!r:operis.local', {}, USER)
    expect(page.chunk).toHaveLength(1)
    expect(page.end).toBe('t2')
  })

  it('defaults to reading backwards, which is how a transcript loads', async () => {
    mockFetch([() => json({ chunk: [], start: 't1' })])
    await new MatrixClient(config).messages('!r:operis.local', {}, USER)
    expect(calls[0].url.searchParams.get('dir')).toBe('b')
  })
})

describe('sync', () => {
  it('runs as the bot by default', async () => {
    // Synapse refuses /sync for the appservice's own sender (matrix-doc#1144).
    mockFetch([() => json({ next_batch: 's1' })])
    const client = new MatrixClient(config)
    await client.sync({})
    expect(calls[0].url.searchParams.get('user_id')).toBe(client.botUserId)
    expect(calls[0].url.searchParams.get('user_id')).not.toBe(client.senderUserId)
  })

  it('passes the since cursor through', async () => {
    mockFetch([() => json({ next_batch: 's2' })])
    await new MatrixClient(config).sync({ since: 's1' })
    expect(calls[0].url.searchParams.get('since')).toBe('s1')
  })

  it('omits since on a first sync rather than sending an empty string', async () => {
    mockFetch([() => json({ next_batch: 's1' })])
    await new MatrixClient(config).sync({ since: null })
    expect(calls[0].url.searchParams.has('since')).toBe(false)
  })
})
