import { deriveRelatedTransactionId, deriveTransactionId, isDerivedTransactionId } from '../transactions'
import { classifyMatrixFailure, MatrixError } from '../errors'

const MESSAGE_ID = '64097a24-ecb4-4795-80c2-bb466858f186'

describe('deriveTransactionId', () => {
  it('is deterministic — the whole point', () => {
    // Idempotency comes from the homeserver returning the ORIGINAL event for a
    // repeated transaction id. A non-deterministic id gives all of the ceremony
    // and none of the guarantee.
    expect(deriveTransactionId(MESSAGE_ID)).toBe(deriveTransactionId(MESSAGE_ID))
  })

  it('separates different messages', () => {
    expect(deriveTransactionId(MESSAGE_ID)).not.toBe(deriveTransactionId('other'))
  })

  it('is URL-path safe', () => {
    // A transaction id travels in the URL path; a raw identifier carrying a
    // slash or colon would need escaping at every call site.
    const id = deriveTransactionId('weird/id:with?chars#and spaces')
    expect(id).toMatch(/^om-[0-9a-f]{32}$/)
    expect(encodeURIComponent(id)).toBe(id)
  })

  it('does not leak the source identifier', () => {
    expect(deriveTransactionId(MESSAGE_ID)).not.toContain(MESSAGE_ID)
  })
})

describe('deriveRelatedTransactionId', () => {
  it('keeps related events on one subject apart', () => {
    // A reaction, an edit and a redaction can all target one message and must
    // not collide with each other or with the message's own send.
    const send = deriveTransactionId(MESSAGE_ID)
    const react = deriveRelatedTransactionId(MESSAGE_ID, 'reaction')
    const redact = deriveRelatedTransactionId(MESSAGE_ID, 'redaction')
    expect(new Set([send, react, redact]).size).toBe(3)
  })

  it('stays deterministic per discriminator', () => {
    expect(deriveRelatedTransactionId(MESSAGE_ID, 'reaction')).toBe(
      deriveRelatedTransactionId(MESSAGE_ID, 'reaction'),
    )
  })
})

describe('isDerivedTransactionId', () => {
  it('recognises our own ids', () => {
    expect(isDerivedTransactionId(deriveTransactionId(MESSAGE_ID))).toBe(true)
  })

  it.each([
    ['a random id', 'om-not-hex'],
    ['a foreign id', 'mautrix-12345'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isDerivedTransactionId(value)).toBe(false)
  })
})

describe('classifyMatrixFailure', () => {
  it.each([
    ['no response at all', 0, undefined, 'transient'],
    ['rate limiting', 429, 'M_LIMIT_EXCEEDED', 'transient'],
    ['a server error', 500, undefined, 'transient'],
    ['a bad gateway', 502, undefined, 'transient'],
    ['an expired token', 401, 'M_UNKNOWN_TOKEN', 'reauth'],
    ['a missing token', 401, 'M_MISSING_TOKEN', 'reauth'],
    ['a deactivated user', 403, 'M_USER_DEACTIVATED', 'reauth'],
    ['a permission refusal', 403, 'M_FORBIDDEN', 'permanent'],
    ['a bad request', 400, 'M_INVALID_PARAM', 'permanent'],
    ['a missing room', 404, 'M_NOT_FOUND', 'permanent'],
  ])('classifies %s', (_label, status, errcode, expected) => {
    expect(classifyMatrixFailure(status as number, errcode as string | undefined)).toBe(expected)
  })

  it('does not treat M_FORBIDDEN as a credential failure', () => {
    // The homeserver returns M_FORBIDDEN both for "your token is bad" and for
    // "this user may not do that". Treating it as reauth would flip a whole
    // channel into a broken state because one user lacked power level.
    expect(classifyMatrixFailure(403, 'M_FORBIDDEN')).toBe('permanent')
  })
})

describe('MatrixError', () => {
  it('exposes its classification as predicates', () => {
    const error = new MatrixError({ message: 'x', kind: 'transient', status: 429, retryAfterMs: 1200 })
    expect(error.isTransient).toBe(true)
    expect(error.isReauth).toBe(false)
    expect(error.isPermanent).toBe(false)
    expect(error.retryAfterMs).toBe(1200)
  })

  it('is instanceof Error, so ordinary handling still works', () => {
    expect(new MatrixError({ message: 'x', kind: 'permanent', status: 400 })).toBeInstanceOf(Error)
  })
})
