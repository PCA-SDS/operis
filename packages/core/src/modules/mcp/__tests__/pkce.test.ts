import crypto from 'node:crypto'
import {
  deriveCodeChallenge,
  isValidCodeChallenge,
  isValidCodeVerifier,
  verifyCodeVerifier,
} from '../lib/pkce'

const verifier = 'abcdefghijklmnopqrstuvwxyz0123456789-._~ABCDEFGHIJ'

describe('PKCE (S256 only)', () => {
  it('accepts a correct verifier for its challenge', () => {
    const challenge = deriveCodeChallenge(verifier)
    expect(isValidCodeChallenge(challenge)).toBe(true)
    expect(verifyCodeVerifier(verifier, challenge)).toBe(true)
  })

  it('rejects a wrong verifier', () => {
    const challenge = deriveCodeChallenge(verifier)
    expect(verifyCodeVerifier(`${verifier.slice(0, -1)}Z`, challenge)).toBe(false)
  })

  it('rejects verifiers outside the RFC 7636 length and charset rules', () => {
    expect(isValidCodeVerifier('short')).toBe(false)
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false)
    expect(isValidCodeVerifier(`${'a'.repeat(42)}!`)).toBe(false)
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true)
  })

  it('never accepts a plain (unhashed) challenge', () => {
    // A `plain` challenge is the verifier itself. S256-only verification must
    // reject it, otherwise an intercepted authorization request would be enough.
    expect(verifyCodeVerifier(verifier, verifier)).toBe(false)
  })

  it('derives the challenge as base64url(SHA-256(verifier))', () => {
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
    expect(deriveCodeChallenge(verifier)).toBe(expected)
  })

  it('rejects a malformed stored challenge', () => {
    expect(verifyCodeVerifier(verifier, 'not-a-challenge')).toBe(false)
    expect(isValidCodeChallenge('short')).toBe(false)
  })
})
