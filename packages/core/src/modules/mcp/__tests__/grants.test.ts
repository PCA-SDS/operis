/**
 * Authorization codes and refresh tokens.
 *
 * The properties under test are the ones OAuth 2.1 makes mandatory: codes are
 * single-use, refresh tokens rotate, and presenting either one twice is treated
 * as theft and revokes the grant rather than merely failing.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { getMcpConnectionConfig } from '../lib/config'
import { hashOpaqueSecret } from '../lib/tokens'
import {
  consumeAuthorizationCode,
  issueAuthorizationCode,
  issueRefreshToken,
  redeemRefreshToken,
} from '../lib/grants'

const ORIGINAL_ENV = { ...process.env }

function config() {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-policy-0123456789'
  process.env.MCP_PUBLIC_URL = 'https://erp.example.com'
  return getMcpConnectionConfig()
}

/**
 * Minimal in-memory stand-in for the EntityManager.
 *
 * `nativeUpdate` mirrors the real conditional-update semantics — it returns the
 * number of rows that actually matched — because that return value is exactly
 * what makes the single-use claim atomic.
 */
function buildEm() {
  const rows: Record<string, unknown>[] = []

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && '$lt' in (value as Record<string, unknown>)) {
        return (row[key] as Date) < ((value as { $lt: Date }).$lt)
      }
      return row[key] === value
    })

  const em = {
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    persist: (row: Record<string, unknown>) => {
      rows.push(row)
      return em
    },
    flush: async () => undefined,
    findOne: async (_entity: unknown, where: Record<string, unknown>) =>
      rows.find((row) => matches(row, where)) ?? null,
    nativeUpdate: async (
      _entity: unknown,
      where: Record<string, unknown>,
      data: Record<string, unknown>,
    ) => {
      const affected = rows.filter((row) => matches(row, where))
      for (const row of affected) Object.assign(row, data)
      return affected.length
    },
    nativeDelete: async () => 0,
    __rows: rows,
  }

  return em as unknown as EntityManager & { __rows: Record<string, unknown>[] }
}

const grant = {
  clientId: 'mcp_client',
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  scopes: ['tasks:read'],
  redirectUri: 'https://app.example.com/cb',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  resource: 'https://erp.example.com/api/mcp/tasks',
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('authorization codes', () => {
  it('stores only a hash of the code, never the code itself', async () => {
    const em = buildEm()
    const { code } = await issueAuthorizationCode(em, grant, config())

    const stored = em.__rows[0]
    expect(stored.codeHash).toBe(hashOpaqueSecret(code))
    expect(JSON.stringify(em.__rows)).not.toContain(code)
  })

  it('consumes a valid code exactly once', async () => {
    const em = buildEm()
    const { code } = await issueAuthorizationCode(em, grant, config())

    const first = await consumeAuthorizationCode(em, code)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.record.userId).toBe(grant.userId)
      expect(first.record.organizationId).toBe(grant.organizationId)
    }
  })

  it('detects replay and revokes every token derived from the code', async () => {
    const em = buildEm()
    const config_ = config()
    const { code } = await issueAuthorizationCode(em, grant, config_)
    await issueRefreshToken(em, grant, config_)

    await consumeAuthorizationCode(em, code)
    const replay = await consumeAuthorizationCode(em, code)

    expect(replay).toEqual({ ok: false, reason: 'replayed' })
    const refreshRow = em.__rows.find((row) => 'tokenHash' in row)
    expect(refreshRow?.revokedAt).toBeInstanceOf(Date)
  })

  it('rejects an unknown code', async () => {
    const em = buildEm()
    expect(await consumeAuthorizationCode(em, 'nope')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('rejects an expired code', async () => {
    const em = buildEm()
    const { code } = await issueAuthorizationCode(em, grant, config())
    const stored = em.__rows[0]
    stored.expiresAt = new Date(Date.now() - 1000)

    expect(await consumeAuthorizationCode(em, code)).toEqual({ ok: false, reason: 'expired' })
  })
})

describe('refresh tokens', () => {
  it('stores only a hash of the token', async () => {
    const em = buildEm()
    const { token } = await issueRefreshToken(em, grant, config())
    expect(em.__rows[0].tokenHash).toBe(hashOpaqueSecret(token))
    expect(JSON.stringify(em.__rows)).not.toContain(token)
  })

  it('redeems a valid token and marks it rotated', async () => {
    const em = buildEm()
    const { token } = await issueRefreshToken(em, grant, config())

    const result = await redeemRefreshToken(em, token)
    expect(result.ok).toBe(true)
    expect(em.__rows[0].rotatedAt).toBeInstanceOf(Date)
  })

  it('detects reuse of a rotated token and revokes the whole grant chain', async () => {
    const em = buildEm()
    const config_ = config()
    const first = await issueRefreshToken(em, grant, config_)
    await redeemRefreshToken(em, first.token)
    // The successor stays on the same grant chain.
    await issueRefreshToken(em, { ...grant, grantId: first.grantId }, config_)

    const reuse = await redeemRefreshToken(em, first.token)
    expect(reuse).toEqual({ ok: false, reason: 'reused' })

    // Both the original and its successor are dead.
    for (const row of em.__rows) expect(row.revokedAt).toBeInstanceOf(Date)
  })

  it('rejects an unknown token', async () => {
    const em = buildEm()
    expect(await redeemRefreshToken(em, 'nope')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('rejects an expired token', async () => {
    const em = buildEm()
    const { token } = await issueRefreshToken(em, grant, config())
    em.__rows[0].expiresAt = new Date(Date.now() - 1000)
    expect(await redeemRefreshToken(em, token)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects an explicitly revoked token', async () => {
    const em = buildEm()
    const { token } = await issueRefreshToken(em, grant, config())
    em.__rows[0].revokedAt = new Date()
    expect(await redeemRefreshToken(em, token)).toEqual({ ok: false, reason: 'revoked' })
  })

  it('keeps the grant id stable across a rotation', async () => {
    const em = buildEm()
    const config_ = config()
    const first = await issueRefreshToken(em, grant, config_)
    const second = await issueRefreshToken(em, { ...grant, grantId: first.grantId }, config_)
    expect(second.grantId).toBe(first.grantId)
  })
})
