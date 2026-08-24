import crypto from 'node:crypto'

/** OAuth 2.1 requires PKCE; this connection accepts S256 only, never `plain`. */
export const SUPPORTED_CODE_CHALLENGE_METHODS = ['S256'] as const

const CODE_VERIFIER_MIN_LENGTH = 43
const CODE_VERIFIER_MAX_LENGTH = 128
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]+$/
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && CODE_CHALLENGE_PATTERN.test(challenge)
}

export function isValidCodeVerifier(verifier: unknown): verifier is string {
  return (
    typeof verifier === 'string' &&
    verifier.length >= CODE_VERIFIER_MIN_LENGTH &&
    verifier.length <= CODE_VERIFIER_MAX_LENGTH &&
    CODE_VERIFIER_PATTERN.test(verifier)
  )
}

export function deriveCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Constant-time comparison of the derived challenge against the stored one, so
 * the endpoint does not leak how much of a guessed verifier was correct.
 */
export function verifyCodeVerifier(verifier: string, storedChallenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(storedChallenge)) return false
  const derived = Buffer.from(deriveCodeChallenge(verifier))
  const expected = Buffer.from(storedChallenge)
  if (derived.length !== expected.length) return false
  return crypto.timingSafeEqual(derived, expected)
}
