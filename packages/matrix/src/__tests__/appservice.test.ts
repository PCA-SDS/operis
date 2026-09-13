import {
  buildRegistration,
  buildSyncFilter,
  extractHomeserverToken,
  parseTransaction,
  verifyHomeserverToken,
} from '../appservice'
import type { MatrixConfig } from '../config'

const config: MatrixConfig = {
  baseUrl: 'http://127.0.0.1:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
  hsToken: 'b'.repeat(64),
  senderLocalpart: 'operis',
  userPrefix: 'om_',
  botLocalpart: 'om_bot',
}

describe('buildRegistration', () => {
  const yaml = buildRegistration(config)

  it('single-quotes the namespace regexes', () => {
    // Load-bearing, and it cost a Synapse that refused to boot to learn: a
    // DOUBLE-quoted YAML scalar processes backslash escapes and rejects `\.`
    // as an unknown escape character. Single quotes pass it through verbatim.
    expect(yaml).toContain("regex: '@om_.*:operis\\.local'")
    expect(yaml).not.toContain('regex: "@om_')
  })

  it('escapes the dots in the server name so the regex cannot match a lookalike domain', () => {
    // Unescaped, `operis.local` matches `operisXlocal` too.
    expect(yaml).toContain('operis\\.local')
  })

  it('marks both namespaces exclusive', () => {
    // Exclusivity is what stops a real signup claiming an Operis localpart.
    expect(yaml.match(/exclusive: true/g)).toHaveLength(2)
  })

  it('emits a bare null url for pull-only operation', () => {
    expect(yaml).toContain('url: null')
  })

  it('emits a quoted url string when push mode is configured', () => {
    const push = buildRegistration(config, { url: 'https://app.example/api/chat_matrix/appservice' })
    expect(push).toContain('url: "https://app.example/api/chat_matrix/appservice"')
  })

  it('opts out of homeserver rate limiting', () => {
    expect(yaml).toContain('rate_limited: false')
  })
})

describe('verifyHomeserverToken', () => {
  const expected = 'c'.repeat(64)

  it('accepts the exact token', () => {
    expect(verifyHomeserverToken(expected, expected)).toBe(true)
  })

  it('rejects a different token of the same length', () => {
    expect(verifyHomeserverToken('d'.repeat(64), expected)).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal lengths; letting that propagate would
    // turn a bad token into a 500 instead of a 403.
    expect(verifyHomeserverToken('short', expected)).toBe(false)
    expect(verifyHomeserverToken('e'.repeat(128), expected)).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
  ])('rejects a %s presented token', (_label, presented) => {
    expect(verifyHomeserverToken(presented, expected)).toBe(false)
  })

  it('rejects when no token is expected, rather than accepting everything', () => {
    // An unconfigured hs_token must fail closed. Accepting any token because
    // none was configured is how an endpoint ends up unauthenticated.
    expect(verifyHomeserverToken('anything', '')).toBe(false)
  })
})

describe('extractHomeserverToken', () => {
  const headers = (value: string | null) => ({ get: () => value })

  it('reads a Bearer header', () => {
    expect(extractHomeserverToken(headers('Bearer abc123'))).toBe('abc123')
  })

  it('is case-insensitive on the scheme', () => {
    expect(extractHomeserverToken(headers('bearer abc123'))).toBe('abc123')
  })

  it.each([
    ['a missing header', null],
    ['a bare token', 'abc123'],
    ['another scheme', 'Basic abc123'],
  ])('returns null for %s', (_label, value) => {
    expect(extractHomeserverToken(headers(value))).toBeNull()
  })
})

describe('parseTransaction', () => {
  const validEvent = {
    type: 'm.room.message',
    event_id: '$abc',
    sender: '@om_bot:operis.local',
    origin_server_ts: 1_700_000_000_000,
    content: { msgtype: 'm.text', body: 'hi' },
  }

  it('returns the parsed events', () => {
    const result = parseTransaction({ events: [validEvent] })
    expect(result?.events).toHaveLength(1)
    expect(result?.events[0].event_id).toBe('$abc')
  })

  it('accepts an empty transaction', () => {
    expect(parseTransaction({ events: [] })).toEqual({ events: [], receivedCount: 0 })
  })

  it('drops a malformed event but keeps the received count', () => {
    // Failing the whole transaction would make Synapse retry the identical
    // payload forever, and because appservice transactions are delivered in
    // order, one unparseable event would stall every later one.
    const result = parseTransaction({ events: [validEvent, { nonsense: true }] })
    expect(result?.events).toHaveLength(1)
    expect(result?.receivedCount).toBe(2)
  })

  it.each([
    ['a non-object body', 'not json'],
    ['events that are not an array', { events: 'nope' }],
  ])('returns null for %s', (_label, body) => {
    expect(parseTransaction(body)).toBeNull()
  })

  it('defaults a missing events key to empty rather than failing', () => {
    expect(parseTransaction({})).toEqual({ events: [], receivedCount: 0 })
  })
})

describe('buildSyncFilter', () => {
  const filter = JSON.parse(buildSyncFilter())

  it('suppresses presence and account data', () => {
    // An unfiltered initial sync returns full room state for every joined room.
    expect(filter.presence.types).toEqual([])
    expect(filter.account_data.types).toEqual([])
    expect(filter.room.state.types).toEqual([])
  })

  it('lazy-loads members', () => {
    expect(filter.room.state.lazy_load_members).toBe(true)
  })

  it('requests only the event types the transport projects', () => {
    expect(filter.room.timeline.types).toEqual([
      'm.room.message',
      'm.reaction',
      'm.room.redaction',
      'm.room.member',
    ])
  })

  it('bounds the timeline page', () => {
    expect(filter.room.timeline.limit).toBe(50)
    expect(JSON.parse(buildSyncFilter({ timelineLimit: 10 })).room.timeline.limit).toBe(10)
  })
})
