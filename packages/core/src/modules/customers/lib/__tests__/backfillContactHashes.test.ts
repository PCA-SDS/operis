/** @jest-environment node */

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { backfillContactHashes } from '../backfillContactHashes'
import { computeEmailLookupHash, computePhoneLookupHash } from '../contactIdentity'

const TENANT = '22222222-2222-4222-8222-222222222222'

type Person = {
  id: string
  primaryPhone?: string | null
  primaryEmail?: string | null
  primaryPhoneHash?: string | null
  primaryEmailHash?: string | null
}

function createEm() {
  const persist = jest.fn()
  const flush = jest.fn(async () => {})
  return { em: { persist, flush } as unknown as EntityManager, persist, flush }
}

describe('backfillContactHashes', () => {
  beforeEach(() => mockFindWithDecryption.mockReset())

  it('fills hashes for rows written before the columns existed', async () => {
    const people: Person[] = [{ id: 'p1', primaryPhone: '+65 9123 4567', primaryEmail: 'ada@example.com' }]
    mockFindWithDecryption.mockResolvedValue(people)
    const { em, flush } = createEm()

    const result = await backfillContactHashes(em, { tenantId: TENANT })

    expect(result).toMatchObject({ scanned: 1, updated: 1, phoneConflicts: [] })
    expect(people[0].primaryPhoneHash).toBe(computePhoneLookupHash('+6591234567'))
    expect(people[0].primaryEmailHash).toBe(computeEmailLookupHash('ada@example.com'))
    expect(flush).toHaveBeenCalled()
  })

  it('scopes the read to the tenant, people only, excluding soft-deleted', async () => {
    mockFindWithDecryption.mockResolvedValue([])
    const { em } = createEm()

    await backfillContactHashes(em, { tenantId: TENANT })

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { tenantId: TENANT, kind: 'person', deletedAt: null },
      {},
      { tenantId: TENANT },
    )
  })

  it('leaves a contested phone unhashed instead of violating the unique index', async () => {
    const people: Person[] = [
      { id: 'p1', primaryPhone: '+6591234567' },
      { id: 'p2', primaryPhone: '+65 9123 4567' },
    ]
    mockFindWithDecryption.mockResolvedValue(people)
    const { em } = createEm()

    const result = await backfillContactHashes(em, { tenantId: TENANT })

    expect(people[0].primaryPhoneHash).toBe(computePhoneLookupHash('+6591234567'))
    expect(people[1].primaryPhoneHash).toBeUndefined()
    expect(result.phoneConflicts).toEqual([['p1', 'p2']])
    expect(result.updated).toBe(1)
  })

  it('still hashes the email of a person whose phone is contested', async () => {
    const people: Person[] = [
      { id: 'p1', primaryPhone: '+6591234567' },
      { id: 'p2', primaryPhone: '+6591234567', primaryEmail: 'second@example.com' },
    ]
    mockFindWithDecryption.mockResolvedValue(people)
    const { em } = createEm()

    await backfillContactHashes(em, { tenantId: TENANT })

    expect(people[1].primaryEmailHash).toBe(computeEmailLookupHash('second@example.com'))
    expect(people[1].primaryPhoneHash).toBeUndefined()
  })

  it('respects a hash an earlier run already claimed', async () => {
    const claimed = computePhoneLookupHash('+6591234567')
    const people: Person[] = [
      { id: 'p1', primaryPhone: '+6591234567', primaryPhoneHash: claimed },
      { id: 'p2', primaryPhone: '+6591234567' },
    ]
    mockFindWithDecryption.mockResolvedValue(people)
    const { em } = createEm()

    const result = await backfillContactHashes(em, { tenantId: TENANT })

    expect(people[1].primaryPhoneHash).toBeUndefined()
    expect(result.phoneConflicts).toEqual([['p1', 'p2']])
  })

  it('clears a stale hash when the phone was removed', async () => {
    const people: Person[] = [{ id: 'p1', primaryPhone: null, primaryPhoneHash: 'stale' }]
    mockFindWithDecryption.mockResolvedValue(people)
    const { em } = createEm()

    const result = await backfillContactHashes(em, { tenantId: TENANT })

    expect(people[0].primaryPhoneHash).toBeNull()
    expect(result.updated).toBe(1)
  })

  it('is idempotent — a second run over hashed rows writes nothing', async () => {
    const people: Person[] = [
      {
        id: 'p1',
        primaryPhone: '+6591234567',
        primaryEmail: 'ada@example.com',
        primaryPhoneHash: computePhoneLookupHash('+6591234567'),
        primaryEmailHash: computeEmailLookupHash('ada@example.com'),
      },
    ]
    mockFindWithDecryption.mockResolvedValue(people)
    const { em, persist, flush } = createEm()

    const result = await backfillContactHashes(em, { tenantId: TENANT })

    expect(result).toMatchObject({ scanned: 1, updated: 0 })
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })
})
