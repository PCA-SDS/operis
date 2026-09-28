import {
  applyPostalAddressPatch,
  assignPostalAddressFields,
  readPostalAddressFields,
  type PostalAddressFields,
  type PostalAddressRecord,
} from '../postalAddress'

const fullFields: PostalAddressFields = {
  name: 'HQ',
  purpose: 'billing',
  companyName: 'Acme',
  addressLine1: 'Main St 1',
  addressLine2: 'Suite 2',
  buildingNumber: '1',
  flatNumber: '2',
  city: 'Warsaw',
  region: 'Mazowieckie',
  postalCode: '00-001',
  country: 'PL',
  latitude: 52.23,
  longitude: 21.01,
  isPrimary: true,
}

describe('postal address fields', () => {
  it('reads every column, turning absent optional ones into null', () => {
    expect(readPostalAddressFields({ addressLine1: 'Main St 1', isPrimary: false })).toEqual({
      name: null,
      purpose: null,
      companyName: null,
      addressLine1: 'Main St 1',
      addressLine2: null,
      buildingNumber: null,
      flatNumber: null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
      latitude: null,
      longitude: null,
      isPrimary: false,
    })
    expect(readPostalAddressFields(fullFields)).toEqual(fullFields)
  })

  it('writes every snapshot field back onto a record', () => {
    const target: PostalAddressRecord & { id: string } = { id: 'a', addressLine1: 'Old', isPrimary: false, city: 'Old city' }
    assignPostalAddressFields(target, { ...fullFields, city: null })
    expect(target).toEqual({ id: 'a', ...fullFields, city: null })
  })

  it('applies only the supplied fields of a patch, with null clearing', () => {
    const target: PostalAddressRecord = { ...fullFields }
    applyPostalAddressPatch(target, { city: 'Krakow', region: null, latitude: undefined, isPrimary: false })
    expect(target).toEqual({ ...fullFields, city: 'Krakow', region: null, isPrimary: false })
    applyPostalAddressPatch(target, {})
    expect(target).toEqual({ ...fullFields, city: 'Krakow', region: null, isPrimary: false })
  })
})
