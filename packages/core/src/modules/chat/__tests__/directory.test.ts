import type { EntityManager } from '@mikro-orm/postgresql'
import { searchOrganizationDirectory } from '../lib/directory'

const findWithDecryption = jest.fn()
const findEntityIdsBySearchTokens = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: (...args: unknown[]) => findEntityIdsBySearchTokens(...args),
}))

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const ME = 'user-me'

type Row = { id: string; name: string | null; email: string }

function user(id: string, name: string, email: string): Row {
  return { id, name, email }
}

/** No roles: `loadRoleNames` short-circuits on an empty id list. */
const em = {
  find: jest.fn(async () => []),
  getKysely: jest.fn(() => ({})),
} as unknown as EntityManager

beforeEach(() => {
  findWithDecryption.mockReset()
  findEntityIdsBySearchTokens.mockReset()
  ;(em.find as jest.Mock).mockClear()
})

describe('searchOrganizationDirectory', () => {
  it('returns a bounded first page for an empty query rather than the whole organization', async () => {
    findWithDecryption.mockResolvedValueOnce([user('u1', 'Ada', 'ada@x.test')])

    const result = await searchOrganizationDirectory(em, SCOPE, { query: '', excludeUserId: ME, limit: 5 })

    expect(result.items.map((item) => item.id)).toEqual(['u1'])
    expect(result.truncated).toBe(false)
    // The index is not consulted for an empty query, and the read is capped.
    expect(findEntityIdsBySearchTokens).not.toHaveBeenCalled()
    const [, , where, options] = findWithDecryption.mock.calls[0]!
    expect(options).toMatchObject({ limit: 5 })
    expect(where).toMatchObject({
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      deletedAt: null,
      isConfirmed: true,
      id: { $ne: ME },
    })
  })

  it('resolves a query through the search-token index and decrypts only the matches', async () => {
    findEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: true, ids: ['u1', 'u2', ME] })
    findWithDecryption.mockResolvedValueOnce([user('u1', 'Ada', 'ada@x.test')])

    const result = await searchOrganizationDirectory(em, SCOPE, { query: 'ada', excludeUserId: ME })

    expect(result.items.map((item) => item.id)).toEqual(['u1'])
    const [, , where] = findWithDecryption.mock.calls[0]!
    // Only the matched ids are loaded, the caller is dropped, and the
    // organization predicate still runs in SQL — the token index is
    // tenant-scoped, not organization-scoped.
    expect(where.id).toEqual({ $in: ['u1', 'u2'] })
    expect(where).toMatchObject({ organizationId: SCOPE.organizationId, tenantId: SCOPE.tenantId })
  })

  it('reports no results when the index matched nothing', async () => {
    findEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: true, ids: [] })

    const result = await searchOrganizationDirectory(em, SCOPE, { query: 'nobody', excludeUserId: ME })

    expect(result.items).toEqual([])
    expect(result.truncated).toBe(false)
    // A confident empty answer, so no scan is attempted.
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  /**
   * The distinction the `…Compat` shim erases.
   *
   * `matched: false` means the index was never consulted — not that nobody
   * matched. Reading it as "no results" would answer a confident empty list
   * whenever search is disabled or a tenant has not been indexed yet.
   */
  it('falls back to a bounded scan when the index was not consulted', async () => {
    findEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: false, reason: 'search-disabled' })
    findWithDecryption.mockResolvedValueOnce([
      user('u1', 'Ada Lovelace', 'ada@x.test'),
      user('u2', 'Grace Hopper', 'grace@x.test'),
      user(ME, 'Me Myself', 'me@x.test'),
    ])

    const result = await searchOrganizationDirectory(em, SCOPE, { query: 'grace', excludeUserId: ME })

    expect(result.items.map((item) => item.id)).toEqual(['u2'])
    expect(result.truncated).toBe(false)
  })

  it('matches on email as well as display name in the fallback', async () => {
    findEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: false, reason: 'no-tokens' })
    findWithDecryption.mockResolvedValueOnce([user('u1', 'Ada Lovelace', 'ada@x.test')])

    const result = await searchOrganizationDirectory(em, SCOPE, { query: 'ADA@X', excludeUserId: ME })
    expect(result.items.map((item) => item.id)).toEqual(['u1'])
  })

  it('flags a truncated fallback so the UI can say the answer is partial', async () => {
    findEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: false, reason: 'search-disabled' })
    // One more than the scan window, which is how truncation is detected.
    findWithDecryption.mockResolvedValueOnce(
      Array.from({ length: 201 }, (_, index) => user(`u${index}`, `Person ${index}`, `p${index}@x.test`)),
    )

    const result = await searchOrganizationDirectory(em, SCOPE, { query: 'person', excludeUserId: ME })
    expect(result.truncated).toBe(true)
  })

  it('never returns the caller', async () => {
    findEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: false, reason: 'no-tokens' })
    findWithDecryption.mockResolvedValueOnce([user(ME, 'Me Myself', 'me@x.test')])

    const result = await searchOrganizationDirectory(em, SCOPE, { query: 'me', excludeUserId: ME })
    expect(result.items).toEqual([])
  })

  it('caps the page size even when a caller asks for more', async () => {
    findWithDecryption.mockResolvedValueOnce([])
    await searchOrganizationDirectory(em, SCOPE, { query: '', excludeUserId: ME, limit: 9999 })
    const [, , , options] = findWithDecryption.mock.calls[0]!
    expect(options.limit).toBe(25)
  })
})
