import {
  annotation,
  isRedacted,
  isReplacement,
  membershipChange,
  messageBody,
  ownTransactionId,
  parseMatrixEvent,
  parseMxcUri,
  replacement,
  replyTarget,
} from '../events'

const base = {
  event_id: '$abc',
  sender: '@om_u_aaa:operis.local',
  origin_server_ts: 1_700_000_000_000,
  room_id: '!room:operis.local',
}

const event = (overrides: Record<string, unknown>) =>
  parseMatrixEvent({ type: 'm.room.message', content: {}, ...base, ...overrides })!

describe('parseMatrixEvent', () => {
  it('accepts a minimal well-formed event', () => {
    expect(event({}).event_id).toBe('$abc')
  })

  it('preserves fields it does not model', () => {
    // `unsigned` carries the redaction marker and our own echo's transaction id.
    // Stripping unknown keys would discard information later phases need.
    const parsed = event({ unsigned: { age: 12, transaction_id: 'om-x' } })
    expect(parsed.unsigned).toEqual({ age: 12, transaction_id: 'om-x' })
  })

  it('defaults absent content to an empty object', () => {
    expect(parseMatrixEvent({ type: 'm.room.message', ...base })?.content).toEqual({})
  })

  it.each([
    ['a missing event_id', { type: 'm.room.message', sender: '@a:b', origin_server_ts: 1 }],
    ['a non-numeric timestamp', { ...base, type: 'm.room.message', origin_server_ts: 'soon' }],
    ['a null body', null],
    ['a string', 'nope'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseMatrixEvent(raw)).toBeNull()
  })
})

describe('messageBody', () => {
  it('reads the body of a message', () => {
    expect(messageBody(event({ content: { msgtype: 'm.text', body: 'hello' } }))).toBe('hello')
  })

  it('returns null for a non-message event', () => {
    expect(messageBody(event({ type: 'm.reaction', content: { body: 'x' } }))).toBeNull()
  })

  it('returns null for an empty body rather than an empty string', () => {
    expect(messageBody(event({ content: { msgtype: 'm.text', body: '' } }))).toBeNull()
  })
})

describe('replyTarget', () => {
  it('reads m.in_reply_to', () => {
    const reply = event({
      content: { body: 'x', 'm.relates_to': { 'm.in_reply_to': { event_id: '$parent' } } },
    })
    expect(replyTarget(reply)).toBe('$parent')
  })

  it('ignores a thread relation', () => {
    // A thread is a different concept that Operis does not model; treating it
    // as a reply would silently reparent messages.
    const threaded = event({
      content: { body: 'x', 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
    })
    expect(replyTarget(threaded)).toBeNull()
  })

  it('returns null when there is no relation', () => {
    expect(replyTarget(event({ content: { body: 'x' } }))).toBeNull()
  })
})

describe('annotation', () => {
  it('reads a reaction target and key', () => {
    const reaction = event({
      type: 'm.reaction',
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$target', key: '👍' } },
    })
    expect(annotation(reaction)).toEqual({ targetEventId: '$target', key: '👍' })
  })

  it('returns null for a reaction with the wrong rel_type', () => {
    const odd = event({
      type: 'm.reaction',
      content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$t', key: 'x' } },
    })
    expect(annotation(odd)).toBeNull()
  })

  it('returns null for a message event', () => {
    expect(annotation(event({ content: { body: 'x' } }))).toBeNull()
  })
})

describe('replacement', () => {
  it('reads the body from m.new_content, not the fallback', () => {
    // `body` holds the `* edited text` fallback that unaware clients display.
    // Projecting that would put a literal asterisk in front of every edit.
    const edit = event({
      content: {
        msgtype: 'm.text',
        body: '* corrected',
        'm.new_content': { msgtype: 'm.text', body: 'corrected' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
      },
    })
    expect(replacement(edit)).toEqual({ targetEventId: '$original', newBody: 'corrected' })
  })

  it('returns null when m.new_content is missing', () => {
    const malformed = event({
      content: { body: '* x', 'm.relates_to': { rel_type: 'm.replace', event_id: '$o' } },
    })
    expect(replacement(malformed)).toBeNull()
  })
})

describe('isReplacement', () => {
  it('recognises an edit', () => {
    const edit = event({
      content: {
        msgtype: 'm.text',
        body: '* corrected',
        'm.new_content': { msgtype: 'm.text', body: 'corrected' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
      },
    })
    expect(isReplacement(edit)).toBe(true)
  })

  /**
   * A malformed edit is still an edit. `replacement` returns null for it because
   * it has no new content to hand back, but a projector that treated that as
   * "not an edit" would put the `* corrected` fallback into the transcript as a
   * brand-new message.
   */
  it('recognises one even without m.new_content, which `replacement` refuses', () => {
    const malformed = event({
      content: { body: '* x', 'm.relates_to': { rel_type: 'm.replace', event_id: '$o' } },
    })
    expect(isReplacement(malformed)).toBe(true)
    expect(replacement(malformed)).toBeNull()
  })

  it('leaves an ordinary message alone', () => {
    expect(isReplacement(event({ content: { msgtype: 'm.text', body: 'hello' } }))).toBe(false)
  })

  /** A rich reply carries no `rel_type` at all, and IS a new message. */
  it('leaves a reply alone', () => {
    const reply = event({
      content: {
        msgtype: 'm.text',
        body: 'agreed',
        'm.relates_to': { 'm.in_reply_to': { event_id: '$parent' } },
      },
    })
    expect(isReplacement(reply)).toBe(false)
  })

  /** A thread reply is a new message too, in a concept Operis does not model. */
  it('leaves a thread relation alone', () => {
    const threaded = event({
      content: {
        msgtype: 'm.text',
        body: 'in the thread',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    })
    expect(isReplacement(threaded)).toBe(false)
  })
})

describe('isRedacted', () => {
  it('detects the unsigned marker', () => {
    expect(isRedacted(event({ unsigned: { redacted_because: { event_id: '$r' } } }))).toBe(true)
  })

  it('detects an emptied message', () => {
    expect(isRedacted(event({ content: {} }))).toBe(true)
  })

  it('does not treat an intact message as redacted', () => {
    expect(isRedacted(event({ content: { msgtype: 'm.text', body: 'still here' } }))).toBe(false)
  })

  it('does not treat an empty non-message event as redacted', () => {
    // A state event with empty content is ordinary, not a tombstone.
    expect(isRedacted(event({ type: 'm.room.topic', content: {} }))).toBe(false)
  })
})

describe('membershipChange', () => {
  it('reads a join', () => {
    const joined = event({
      type: 'm.room.member',
      state_key: '@om_u_bbb:operis.local',
      content: { membership: 'join', displayname: 'Bao' },
    })
    expect(membershipChange(joined)).toEqual({
      userId: '@om_u_bbb:operis.local',
      membership: 'join',
      displayName: 'Bao',
    })
  })

  it('returns null for an unknown membership value', () => {
    const odd = event({
      type: 'm.room.member',
      state_key: '@a:b',
      content: { membership: 'lurking' },
    })
    expect(membershipChange(odd)).toBeNull()
  })

  it('returns null without a state_key', () => {
    expect(membershipChange(event({ type: 'm.room.member', content: { membership: 'join' } }))).toBeNull()
  })
})

describe('ownTransactionId', () => {
  it('reads our echo marker', () => {
    // How the sync loop recognises an event it already projected inline on the
    // send path, without a database round trip per event.
    expect(ownTransactionId(event({ unsigned: { transaction_id: 'om-deadbeef' } }))).toBe('om-deadbeef')
  })

  it('returns null for someone else’s event', () => {
    expect(ownTransactionId(event({ unsigned: { age: 5 } }))).toBeNull()
    expect(ownTransactionId(event({}))).toBeNull()
  })
})

describe('parseMxcUri', () => {
  it('splits a well-formed uri', () => {
    expect(parseMxcUri('mxc://operis.local/AbC123')).toEqual({
      serverName: 'operis.local',
      mediaId: 'AbC123',
    })
  })

  it.each([
    ['an http url', 'https://operis.local/media/x'],
    ['a missing media id', 'mxc://operis.local'],
    ['an empty string', ''],
  ])('returns null for %s', (_label, uri) => {
    expect(parseMxcUri(uri)).toBeNull()
  })
})
