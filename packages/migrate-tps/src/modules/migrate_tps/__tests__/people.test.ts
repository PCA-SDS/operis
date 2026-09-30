import { computePhoneLookupHash } from '@open-mercato/core/modules/customers/lib/contactIdentity'
import { migrateCustomers } from '../people'

describe('migrateCustomers', () => {
  it('repairs stale persisted phone ownership before assigning desired identities', async () => {
    const sourceCustomerA = {
      id: 'tps-a',
      name: 'Customer A',
      salutation: null,
      email: null,
      password: '',
      phone: '67506723',
      phone_country_code: '+852',
      phone_country: 'HK',
      origin: 'tourist',
      referral: null,
      created_at: new Date('2026-08-21T04:52:23.000Z'),
    }
    const sourceCustomerB = {
      ...sourceCustomerA,
      id: 'tps-b',
      name: 'Customer B',
      phone: '85267506723',
      created_at: new Date('2026-08-21T07:07:24.000Z'),
    }
    const customerA = {
      id: 'entity-a',
      description: '[tps-customer-id:tps-a]',
      displayName: 'Customer A',
      primaryPhone: null,
      primaryPhoneHash: null,
      phoneCountryCode: null,
      phoneCountry: null,
    }
    const customerB = {
      id: 'entity-b',
      description: '[tps-customer-id:tps-b]',
      displayName: 'Customer B',
      primaryPhone: '+852 67506723',
      primaryPhoneHash: computePhoneLookupHash('+852 67506723'),
      phoneCountryCode: '852',
      phoneCountry: 'HK',
    }
    const em = {
      find: jest.fn().mockResolvedValue([customerA, customerB]),
      findOne: jest.fn().mockResolvedValue(null),
      flush: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      persist: jest.fn(),
    }

    const result = await migrateCustomers(
      em as never,
      [sourceCustomerA, sourceCustomerB],
      'tenant-id',
      'organization-id',
      true,
      false,
      false,
    )

    expect(result).toMatchObject({ created: 0, updated: 2, skipped: 0, phoneConflicts: 0 })
    expect(customerA.primaryPhone).toBe('+852 67506723')
    expect(customerA.primaryPhoneHash).toBe(computePhoneLookupHash('+852 67506723'))
    expect(customerB.primaryPhone).toBe('+852 85267506723')
    expect(customerB.primaryPhoneHash).toBe(computePhoneLookupHash('+852 85267506723'))
    expect(customerA.primaryPhoneHash).not.toBe(customerB.primaryPhoneHash)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
