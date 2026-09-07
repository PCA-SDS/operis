/**
 * Paging the Shared panel.
 *
 * The cursor carries a timestamp and an id together, and the id is the part
 * that matters: a message sent with twenty images writes twenty rows at one
 * instant, so a time-only cursor lands inside that group and either repeats or
 * skips the rest of it.
 */
import { decodeSharedCursor, encodeSharedCursor } from '../lib/shared'

describe('shared cursor', () => {
  it('round-trips', () => {
    const cursor = { createdAt: '2026-09-10T10:00:00.000Z', id: '11111111-1111-4111-8111-111111111111' }
    expect(decodeSharedCursor(encodeSharedCursor(cursor))).toEqual(cursor)
  })

  it('carries an id, so a group sharing one timestamp still pages cleanly', () => {
    const first = { createdAt: '2026-09-10T10:00:00.000Z', id: 'aaaaaaaa-1111-4111-8111-111111111111' }
    const second = { createdAt: '2026-09-10T10:00:00.000Z', id: 'bbbbbbbb-1111-4111-8111-111111111111' }
    expect(encodeSharedCursor(first)).not.toBe(encodeSharedCursor(second))
  })

  it('treats a stale or malformed bookmark as the top of the list', () => {
    // Refusing would turn a bookmark the reader cannot regenerate into an error
    // they cannot act on.
    expect(decodeSharedCursor(undefined)).toBeNull()
    expect(decodeSharedCursor('')).toBeNull()
    expect(decodeSharedCursor('not-base64!!')).toBeNull()
  })

  it('rejects a cursor whose timestamp is not a date', () => {
    const forged = Buffer.from('not-a-date|11111111-1111-4111-8111-111111111111', 'utf8').toString(
      'base64url',
    )
    expect(decodeSharedCursor(forged)).toBeNull()
  })

  it('rejects a cursor missing either half', () => {
    const halfOnly = Buffer.from('2026-09-10T10:00:00.000Z', 'utf8').toString('base64url')
    expect(decodeSharedCursor(halfOnly)).toBeNull()
  })
})
