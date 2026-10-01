/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { computeEmailLookupHash, computePhoneLookupHash } from '../contactIdentity'
import { checkPersonIdentity, findOrCreatePersonForIntake } from '../personLookup'

const TENANT = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999'

type Row = { id: string; tenantId: string; phone?: string; email?: string; phoneCountryCode?: string | null; deleted?: boolean }

/**
 * Stands in for the columns the real query filters on: rows are matched by the
 * same deterministic hashes the lookup builds, so a formatting-only difference
 * between the stored and queried phone still has to resolve to the same person.
 */
function createEm(rows: Row[]) {
  const findOne = jest.fn(async (entity: unknown, where: Record<string, any>) => {
    if ((entity as any)?.name === 'Tenant') {
      return where.id === TENANT || where.id === OTHER_TENANT ? { id: where.id, isActive: true, deletedAt: null } : null
    }
    if ((entity as any)?.name === 'CustomerEntity') {
      if (where.id) {
         const hit = rows.find(r => r.id === where.id)
         return hit ? { id: hit.id, primaryPhone: hit.phone, primaryEmail: hit.email } : null
      }
      if (where.primaryPhoneHash) {
         const wantedHashes = typeof where.primaryPhoneHash === 'string'
           ? [where.primaryPhoneHash]
           : where.primaryPhoneHash.$in as string[]
         const allowedCodes = Array.isArray(where.$or)
           ? where.$or.map((clause: { phoneCountryCode: string | null }) => clause.phoneCountryCode)
           : null
         const hit = rows.find(r => 
           r.tenantId === where.tenantId && 
           !r.deleted && 
           (allowedCodes === null || allowedCodes.includes(r.phoneCountryCode ?? null)) &&
           Boolean(r.phone && wantedHashes.includes(computePhoneLookupHash(r.phone) ?? ''))
         )
         return hit ? { id: hit.id, primaryPhone: hit.phone, primaryEmail: hit.email, phoneCountryCode: hit.phoneCountryCode } : null
      }
      if (where.primaryEmailHash) {
         const wantedHashes = where.primaryEmailHash.$in as string[]
         const hit = rows.find(r =>
           r.tenantId === where.tenantId &&
           !r.deleted &&
           Boolean(r.email && wantedHashes.includes(computeEmailLookupHash(r.email) ?? ''))
         )
         return hit ? { id: hit.id, primaryPhone: hit.phone, primaryEmail: hit.email, phoneCountryCode: hit.phoneCountryCode } : null
      }
      return null
    }
    return null
  })
  
  const createQueryBuilder = jest.fn((entity: unknown, alias: string) => {
    let _where: any = {}
    let _emailStr = ''
    return {
      select: jest.fn().mockReturnThis(),
      where: jest.fn((w) => { _where = w; return this }),
      andWhere: jest.fn((sql, params) => { _emailStr = params[0]; return this }),
      limit: jest.fn().mockReturnThis(),
      getSingleResult: jest.fn(async () => {
         const hit = rows.find(r => 
           r.tenantId === _where.tenantId && 
           !r.deleted && 
           r.email?.toLowerCase() === _emailStr.toLowerCase()
         )
         return hit ? { id: hit.id } : null
      })
    }
  })

  return { em: { findOne, createQueryBuilder } as unknown as EntityManager, findOne }
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
    expect(findOne).toHaveBeenCalledTimes(1)
  })

  it('treats whitespace-only values as absent', async () => {
    const { em } = createEm([])
    const error = await captureError(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '  ', email: ' ' }))
    expect(error.status).toBe(400)
  })

  it('matches a stored number written in a different format', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+65 9123 4567', phoneCountryCode: '65' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', phoneCountryCode: '65' })).resolves.toMatchObject({
      exists: true,
    })
  })

  it('matches a locally entered number against its encrypted phone digest', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '203 400 7772', phoneCountryCode: '1' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '2034007772', phoneCountryCode: '+1' })).resolves.toMatchObject({
      exists: true,
      customer: { id: 'p1', phoneCountryCode: '1' },
    })
  })

  it('matches a person saved without a country code by the full international number', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+15550134477', phoneCountryCode: null }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+1 5550134477', phoneCountryCode: '1' })).resolves.toMatchObject({
      exists: true,
      customer: { id: 'p1' },
    })
  })

  it('matches a nationally stored number when the booking sends it internationally', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '203 400 7772', phoneCountryCode: '1' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+1 203 400 7772', phoneCountryCode: '1' })).resolves.toMatchObject({
      exists: true,
      customer: { id: 'p1' },
    })
  })

  it('does not match the same national digits stored under another country code', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '203 400 7772', phoneCountryCode: '44' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+1 203 400 7772', phoneCountryCode: '1' })).resolves.toMatchObject({
      exists: false,
    })
  })

  it('matches on email case-insensitively', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, email: 'ada@example.com' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { email: 'ADA@Example.com' })).resolves.toMatchObject({
      exists: true,
      customer: { id: 'p1' },
    })
  })

  it('requires every supplied contact to match for public identity verification', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', phoneCountryCode: '65' }])
    await expect(checkPersonIdentity(
      em,
      { tenantId: TENANT },
      { phone: '+6591234567', phoneCountryCode: '65', email: 'unmatched@example.com' },
      { requireAllProvidedContactsMatch: true },
    )).resolves.toMatchObject({ exists: false, customer: null })
  })

  it('reports a miss for an unknown contact', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', phoneCountryCode: '65' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6599999999', phoneCountryCode: '65' })).resolves.toMatchObject({
      exists: false,
    })
  })

  it('never discloses customer fields, only existence', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', email: 'ada@example.com', phoneCountryCode: '65' }])
    const result = await checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', phoneCountryCode: '65' })
    expect(Object.keys(result).sort()).toEqual(['customer', 'exists', 'lastBooking'])
  })

  it('does not match a person belonging to another tenant', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: OTHER_TENANT, phone: '+6591234567', phoneCountryCode: '65' }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', phoneCountryCode: '65' })).resolves.toMatchObject({
      exists: false,
    })
  })

  it('ignores soft-deleted people', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', phoneCountryCode: '65', deleted: true }])
    await expect(checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', phoneCountryCode: '65' })).resolves.toMatchObject({
      exists: false,
    })
  })

  it('conflicts when phone and email point at different people', async () => {
    const { em } = createEm([
      { id: 'p1', tenantId: TENANT, phone: '+6591234567', phoneCountryCode: '65' },
      { id: 'p2', tenantId: TENANT, email: 'other@example.com' },
    ])
    const error = await captureError(
      checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', phoneCountryCode: '65', email: 'other@example.com' }),
    )
    expect(error.status).toBe(409)
    expect(error.body).toMatchObject({ code: 'PERSON_IDENTITY_CONFLICT' })
  })

  it('does not conflict when both point at the same person', async () => {
    const { em } = createEm([{ id: 'p1', tenantId: TENANT, phone: '+6591234567', email: 'ada@example.com', phoneCountryCode: '65' }])
    await expect(
      checkPersonIdentity(em, { tenantId: TENANT }, { phone: '+6591234567', phoneCountryCode: '65', email: 'ada@example.com' }),
    ).resolves.toMatchObject({ exists: true })
  })

})

describe('findOrCreatePersonForIntake', () => {
  const ORGANIZATION = '33333333-3333-4333-8333-333333333333'

  function createIntakeEm(rows: Row[]) {
    const { em, findOne } = createEm(rows)
    const created: Record<string, unknown>[] = []
    const base = findOne.getMockImplementation()!
    findOne.mockImplementation(async (entity: unknown, where: Record<string, any>) => {
      const name = (entity as { name?: string })?.name
      if (name === 'Organization') return { id: where.id }
      if (name === 'CustomerPersonProfile') return null
      return base(entity, where)
    })
    Object.assign(em, {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
        const row = { id: `new-${created.length + 1}`, ...data }
        created.push(row)
        return row
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => {}),
    })
    return { em, created }
  }

  const intakeInput = {
    tenantId: TENANT,
    organizationId: ORGANIZATION,
    firstName: 'Sam',
    lastName: 'Patel',
    phone: '+1 5550134477',
    phoneCountryCode: '1',
    email: 'Sam@Example.com',
  }

  it('stores the phone and email lookup hashes on a new person so the next booking finds them', async () => {
    const { em, created } = createIntakeEm([])

    const result = await findOrCreatePersonForIntake(em, intakeInput)

    expect(result.created).toBe(true)
    const person = created.find((row) => row.kind === 'person')
    expect(person).toMatchObject({
      primaryPhoneHash: computePhoneLookupHash('+1 5550134477'),
      primaryEmailHash: computeEmailLookupHash('sam@example.com'),
    })
  })

  it('reuses the person the People form saved without a country code', async () => {
    const { em, created } = createIntakeEm([{ id: 'p1', tenantId: TENANT, phone: '+15550134477', phoneCountryCode: null }])

    const result = await findOrCreatePersonForIntake(em, intakeInput)

    expect(result).toMatchObject({ entityId: 'p1', created: false })
    expect(created).toHaveLength(0)
  })

  it('leaves the phone hash empty when another person already holds the number', async () => {
    const { em, created } = createIntakeEm([{ id: 'p1', tenantId: TENANT, phone: '+15550134477', phoneCountryCode: '44' }])

    const result = await findOrCreatePersonForIntake(em, intakeInput)

    expect(result.created).toBe(true)
    expect(created.find((row) => row.kind === 'person')).toMatchObject({ primaryPhoneHash: null })
  })
})
