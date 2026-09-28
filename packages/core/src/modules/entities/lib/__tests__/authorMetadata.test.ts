/** @jest-environment node */

const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import { attachAuthorMetadata } from '../authorMetadata'

const forkedEm = { forked: true }
const ctx = {
  container: { resolve: jest.fn(() => ({ fork: () => forkedEm })) },
  auth: { tenantId: 'tenant-1' },
  selectedOrganizationId: 'org-1',
}

describe('attachAuthorMetadata', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    ctx.container.resolve.mockClear()
  })

  it('adds author name and email from either id spelling, keeping existing snake_case values', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'user-1', name: '  Ada Lovelace  ', email: 'ada@example.com' },
      { id: 'user-2', name: '   ', email: null },
    ])
    const items: Array<Record<string, unknown>> = [
      { id: 'a', author_user_id: 'user-1' },
      { id: 'b', authorUserId: 'user-2', author_name: 'kept' },
      { id: 'c', author_user_id: 'user-3' },
      { id: 'd' },
    ]

    await attachAuthorMetadata(items, ctx)

    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      forkedEm,
      expect.anything(),
      { id: { $in: ['user-1', 'user-2', 'user-3'] } },
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(items[0]).toMatchObject({ authorName: 'Ada Lovelace', authorEmail: 'ada@example.com', author_name: 'Ada Lovelace', author_email: 'ada@example.com' })
    expect(items[1]).toMatchObject({ authorName: null, authorEmail: null, author_name: 'kept', author_email: null })
    expect(items[2]).not.toHaveProperty('authorName')
    expect(items[3]).not.toHaveProperty('authorName')
  })

  it('skips the lookup when no item names an author', async () => {
    await attachAuthorMetadata([{ id: 'a' }, null, 'text'], ctx)

    expect(ctx.container.resolve).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('rejects when the user lookup fails so the caller can log it', async () => {
    findWithDecryptionMock.mockRejectedValue(new Error('db down'))

    await expect(attachAuthorMetadata([{ author_user_id: 'user-1' }], ctx)).rejects.toThrow('db down')
  })
})
