/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity, CustomerPersonProfile } from '../../data/entities'
import { phoneLookupHashCandidates } from '../contactIdentity'
import { searchPeopleForBooking } from '../personLookup'
import { findEntityIdsBySearchTokensCompat } from '@open-mercato/shared/lib/search/tokenLookup'

jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokensCompat: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

describe('searchPeopleForBooking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(findEntityIdsBySearchTokensCompat).mockResolvedValue([])
  })

  it('searches phone numbers using lookup hashes instead of encrypted phone text', async () => {
    jest.mocked(findWithDecryption)
      .mockResolvedValueOnce([{
        id: 'customer-1',
        displayName: 'Patricia Patricia',
        primaryEmail: null,
        primaryPhone: '17684403573',
        phoneCountryCode: '49',
        phoneCountry: 'DE',
        origin: null,
        source: null,
      }] as CustomerEntity[])
      .mockResolvedValueOnce([] as CustomerPersonProfile[])

    const result = await searchPeopleForBooking(
      { getKysely: jest.fn() } as unknown as EntityManager,
      { tenantId: 'tenant-1' },
      '1768 440 3573',
    )

    expect(result).toHaveLength(1)
    const customerSearch = jest.mocked(findWithDecryption).mock.calls[0][2] as Record<string, unknown>
    expect(customerSearch).toMatchObject({
      tenantId: 'tenant-1',
      kind: 'person',
      deletedAt: null,
      $or: [
        { displayName: { $ilike: '%1768 440 3573%' } },
        { primaryPhoneHash: { $in: phoneLookupHashCandidates('1768 440 3573') } },
      ],
    })
    expect(findEntityIdsBySearchTokensCompat).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'customers:customer_entity',
      fields: ['primary_phone'],
      query: '17684403573',
      scope: { tenantId: 'tenant-1' },
    }))
    expect(JSON.stringify(customerSearch)).not.toContain('primaryPhone:')
    expect(jest.mocked(findWithDecryption).mock.calls[0][1]).toBe(CustomerEntity)
    expect(jest.mocked(findWithDecryption).mock.calls[1][1]).toBe(CustomerPersonProfile)
  })

  it('matches partial phone digits through tenant-scoped phone search tokens', async () => {
    jest.mocked(findEntityIdsBySearchTokensCompat).mockImplementation(async ({ fields }) =>
      fields?.includes('primary_phone') ? ['customer-1'] : [],
    )
    jest.mocked(findWithDecryption)
      .mockResolvedValueOnce([{
        id: 'customer-1',
        displayName: 'Tiến',
        primaryPhone: '842722728',
        origin: null,
        source: null,
      }] as CustomerEntity[])
      .mockResolvedValueOnce([] as CustomerPersonProfile[])

    const result = await searchPeopleForBooking(
      { getKysely: jest.fn() } as unknown as EntityManager,
      { tenantId: 'tenant-1' },
      '8427',
    )

    expect(result.map((person) => person.id)).toEqual(['customer-1'])
    const customerSearch = jest.mocked(findWithDecryption).mock.calls[0][2] as Record<string, unknown>
    expect(customerSearch).toMatchObject({
      $or: [
        { displayName: { $ilike: '%8427%' } },
        { id: { $in: ['customer-1'] } },
        { primaryPhoneHash: { $in: phoneLookupHashCandidates('8427') } },
      ],
    })
  })

  it('uses display-name tokens for name searches without querying phone tokens', async () => {
    jest.mocked(findEntityIdsBySearchTokensCompat).mockResolvedValue(['customer-1'])
    jest.mocked(findWithDecryption)
      .mockResolvedValueOnce([{
        id: 'customer-1',
        displayName: 'Ha Trinh',
        primaryEmail: null,
        primaryPhone: '4352372488',
        origin: null,
        source: null,
      }] as CustomerEntity[])
      .mockResolvedValueOnce([] as CustomerPersonProfile[])

    const result = await searchPeopleForBooking(
      { getKysely: jest.fn() } as unknown as EntityManager,
      { tenantId: 'tenant-1' },
      'Ha Trinh',
    )

    expect(result.map((person) => person.displayName)).toEqual(['Ha Trinh'])
    expect(findEntityIdsBySearchTokensCompat).toHaveBeenCalledTimes(1)
    expect(findEntityIdsBySearchTokensCompat).toHaveBeenCalledWith(expect.objectContaining({
      fields: ['display_name'],
      query: 'Ha Trinh',
      scope: { tenantId: 'tenant-1' },
    }))
  })
})
