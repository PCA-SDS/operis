/** @jest-environment node */

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/emailHash', () => ({
  emailHashLookupValues: (email: string) => [`hash:${email}`],
}))

import { resolveMessageSenderUserId } from '../messagesIntegration'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const em = {} as never
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function lastWhere(): Record<string, unknown> {
  return mockFindOneWithDecryption.mock.calls.at(-1)?.[2] as Record<string, unknown>
}

describe('resolveMessageSenderUserId', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  it('returns the user id when the sender matches a user in this tenant', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'user-found' })

    const result = await resolveMessageSenderUserId(em, 'jane@example.com', ['admin-1'], scope)

    expect(result).toBe('user-found')
  })

  it('scopes the lookup to the receiving tenant', async () => {
    // `users` is UNIQUE (tenant_id, email_hash), not globally unique. Without the
    // predicate a sender address that also exists in another tenant resolved to
    // that tenant's user, whose id became `messages.sender_user_id` here — and the
    // messages list renders sender name/email by id with no tenant filter.
    mockFindOneWithDecryption.mockResolvedValue({ id: 'user-found' })

    await resolveMessageSenderUserId(em, 'jane@example.com', ['admin-1'], scope)

    expect(lastWhere()).toMatchObject({ tenantId: 'tenant-1', deletedAt: null })
  })

  it('matches the encrypted column by hash as well as plaintext', async () => {
    // `users.email` is encrypted at rest with a per-row IV, so a plaintext
    // comparison never matches and the sender always fell through to a recipient.
    mockFindOneWithDecryption.mockResolvedValue({ id: 'user-found' })

    await resolveMessageSenderUserId(em, 'jane@example.com', ['admin-1'], scope)

    expect(lastWhere().$or).toEqual([
      { email: 'jane@example.com' },
      { emailHash: { $in: ['hash:jane@example.com'] } },
    ])
  })

  it('normalizes the address before looking it up', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'user-ci' })

    await resolveMessageSenderUserId(em, '  Jane@Example.COM  ', ['admin-1'], scope)

    expect(lastWhere().$or).toEqual([
      { email: 'jane@example.com' },
      { emailHash: { $in: ['hash:jane@example.com'] } },
    ])
  })

  it('falls back to the first recipient when no user matches', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const result = await resolveMessageSenderUserId(em, 'unknown@example.com', ['admin-1', 'admin-2'], scope)

    expect(result).toBe('admin-1')
  })

  it('returns SYSTEM_USER_ID when nothing matches and there are no recipients', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const result = await resolveMessageSenderUserId(em, 'nobody@example.com', [], scope)

    expect(result).toBe(SYSTEM_USER_ID)
  })

  it('falls back gracefully when the lookup throws', async () => {
    mockFindOneWithDecryption.mockRejectedValue(new Error('DB connection failed'))

    const result = await resolveMessageSenderUserId(em, 'jane@example.com', ['fallback-admin'], scope)

    expect(result).toBe('fallback-admin')
  })
})
