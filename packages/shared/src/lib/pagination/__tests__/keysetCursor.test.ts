import { decodeKeysetCursor, encodeKeysetCursor } from '../keysetCursor'

describe('keyset pagination cursors', () => {
  const cursor = { createdAt: new Date('2026-09-03T10:15:30.123Z'), id: 'abc-123' }

  it('round-trips an instant and an id', () => {
    const decoded = decodeKeysetCursor(encodeKeysetCursor(cursor))
    expect(decoded?.id).toBe(cursor.id)
    expect(decoded?.createdAt.toISOString()).toBe(cursor.createdAt.toISOString())
  })

  it('keeps millisecond precision, so two rows in the same second stay ordered', () => {
    const a = { createdAt: new Date('2026-09-03T10:15:30.001Z'), id: 'a' }
    const b = { createdAt: new Date('2026-09-03T10:15:30.002Z'), id: 'b' }
    expect(decodeKeysetCursor(encodeKeysetCursor(a))!.createdAt.getTime()).not.toBe(
      decodeKeysetCursor(encodeKeysetCursor(b))!.createdAt.getTime(),
    )
  })

  it('survives an id containing the separator character', () => {
    const weird = { createdAt: cursor.createdAt, id: 'a|b|c' }
    expect(decodeKeysetCursor(encodeKeysetCursor(weird))?.id).toBe('a|b|c')
  })

  /**
   * Cursors arrive from the query string, so garbage means "start from the
   * beginning" rather than a 500 — a stale bookmark should show the first page.
   */
  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not base64', '!!!!'],
    ['no separator', Buffer.from('nope', 'utf8').toString('base64url')],
    ['bad date', Buffer.from('not-a-date|abc', 'utf8').toString('base64url')],
    ['no id', Buffer.from('2026-09-03T10:15:30.123Z|', 'utf8').toString('base64url')],
  ])('treats a %s cursor as absent', (_label, raw) => {
    expect(decodeKeysetCursor(raw as string | undefined)).toBeNull()
  })
})
