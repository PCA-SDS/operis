/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { computeEmailLookupHash, computePhoneLookupHash } from '../contactIdentity'
import { checkPersonIdentity } from '../personLookup'

const TENANT = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999'

type Row = { id: string; tenantId: string; phone?: string; email?: string; deleted?: boolean }

/**
 * Stands in for the columns the real query filters on: rows are matched by the
 * same deterministic hashes the lookup builds, so a formatting-only difference
 * between the stored and queried phone still has to resolve to the same person.
 */
function createEm(rows: Row[]) {
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, any>) => {
    const wanted: string[] = where.primaryPhoneHash?.$in ?? where.primaryEmailHash?.$in ?? []
    const byPhone = Boolean(where.primaryPhoneHash)
    const hit = rows.find((row) => {
      if (row.tenantId !== where.tenantId) return false
      if (row.deleted) return false
      const hash = byPhone ? computePhoneLookupHash(row.phone) : computeEmailLookupHash(row.email)
      return hash != null && wanted.includes(hash)
    })
    return hit ? { id: hit.id } : null
  })
  return { em: { findOne } as unknown as EntityManager, findOne }
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    if (!isCrudHttpError(error)) throw error
    return error
  }
}

describe('checkPersonIdentity', () => {
  it('rejects a request carrying neither phone nor email', async () => {
    const { em, findOne } = createEm([])
    const error = await captureError(checkPersonIdentity(em, { tenantId: TENANT }, {}))
    expect(error.status).toBe(400)
    expect(error.body).toMatchObject({ code: 'PHONE_OR_EMAIL_REQUIRED' })
    expect(findOne).not.toHaveBeenCalled()
  })

  it('treats whitespace-only values as absent', async () => {
    const { em } = createEm([])
    const error = await captureError(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '  ', email: ' ' }))
    expect(error.status).toBe(400)
  })

  it('matches a stored number written in a different format', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+65 9123 4567' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567' })).resolves.toEqual({
      exists: true,
    })
  })

  it('matches on email case-insensitively', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, email: 'ada@example.com' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { email: 'ADA@Example.com' })).resolves.toEqual({
      exists: true,
    })
  })

  it('reports a miss for an unknown contact', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6599999999' })).resolves.toEqual({
      exists: false,
    })
  })

  it('never discloses customer fields, only existence', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', email: 'ada@example.com' }])
    const result = await checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567' })
    expect(Object.keys(result)).toEqual(['exists'])
  })

  it('does not match a person belonging to another tenant', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: OTHER_TENANT, phone: '+6591234567' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567' })).resolves.toEqual({
      exists: false,
    })
  })

  it('ignores soft-deleted people', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', deleted: true }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567' })).resolves.toEqual({
      exists: false,
    })
  })

  it('conflicts when phone and email point at different people', async () => {
    const { em } = createEm([
      { id: 'p1', tenantId: TENANT, phone: '+6591234567' },
      { id: 'p2', tenantId: TENANT, email: 'other@example.com' },
    ])
    const error = await captureError(
      checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', email: 'other@example.com' }),
    )
    expect(error.status).toBe(409)
    expect(error.body).toMatchObject({ code: 'PERSON_IDENTITY_CONFLICT' })
  })

  it('does not conflict when both point at the same person', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', email: 'ada@example.com' }])
    await expect(
      checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', email: 'ada@example.com' }),
    ).resolves.toEqual({ exists: true })
  })

  it('selects only the id, so no encrypted column is read back', async () => {
    const { em, findOne } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567' }])
    await checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567' })
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, kind: 'person', deletedAt: null }),
      { fields: ['id'] },
    )
  })
})
