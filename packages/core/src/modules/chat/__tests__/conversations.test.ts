import { buildDirectKey, buildMessagePreview, parseDirectKey, MESSAGE_PREVIEW_LENGTH } from '../lib/conversations'

/**
 * The canonical-pair rule. This is the property the unique index enforces in
 * the database, so it is asserted here as well: if the key ever became
 * order-dependent, "Alice → Bob" and "Bob → Alice" would land in different rows
 * and each person would be talking into their own copy of the conversation.
 */
describe('buildDirectKey', () => {
  const alice = '11111111-1111-4111-8111-111111111111'
  const bob = '22222222-2222-4222-8222-222222222222'

  it('is the same key whichever side starts the conversation', () => {
    expect(buildDirectKey(alice, bob)).toBe(buildDirectKey(bob, alice))
  })

  it('sorts the pair so the key is deterministic', () => {
    expect(buildDirectKey(bob, alice)).toBe(`${alice}:${bob}`)
  })

  it('distinguishes different pairs', () => {
    const carol = '33333333-3333-4333-8333-333333333333'
    expect(buildDirectKey(alice, bob)).not.toBe(buildDirectKey(alice, carol))
  })

  it('round-trips through parseDirectKey', () => {
    expect(parseDirectKey(buildDirectKey(bob, alice))).toEqual([alice, bob])
  })

  it('rejects a malformed key rather than guessing', () => {
    expect(parseDirectKey('not-a-key')).toBeNull()
    expect(parseDirectKey(':')).toBeNull()
    expect(parseDirectKey(`${alice}:`)).toBeNull()
  })
})

describe('buildMessagePreview', () => {
  it('collapses newlines so a preview stays one line', () => {
    expect(buildMessagePreview('first line\n\nsecond line')).toBe('first line second line')
  })

  it('truncates a long body and marks it', () => {
    const preview = buildMessagePreview('x'.repeat(MESSAGE_PREVIEW_LENGTH + 50))
    expect(preview).toHaveLength(MESSAGE_PREVIEW_LENGTH)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('leaves a short body untouched', () => {
    expect(buildMessagePreview('  hello  ')).toBe('hello')
  })
})
