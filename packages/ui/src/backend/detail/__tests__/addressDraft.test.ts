import { addressServerFieldMap, defaultAddressDraft, extractValidationDetails } from '../addressDraft'

describe('extractValidationDetails', () => {
  it('returns the object entries of an error details array', () => {
    const detail = { path: ['city'], code: 'too_small', minimum: 1, type: 'string' }
    expect(extractValidationDetails({ details: [detail, null, 'text', 3] })).toEqual([detail])
  })

  it('returns an empty list when the error carries no details array', () => {
    expect(extractValidationDetails(null)).toEqual([])
    expect(extractValidationDetails('failed')).toEqual([])
    expect(extractValidationDetails({ details: 'nope' })).toEqual([])
    expect(extractValidationDetails(new Error('failed'))).toEqual([])
  })
})

describe('address draft defaults', () => {
  it('maps every draft field from the server name of the same spelling', () => {
    expect(Object.keys(addressServerFieldMap).sort()).toEqual(Object.keys(defaultAddressDraft).sort())
    for (const [serverField, draftField] of Object.entries(addressServerFieldMap)) {
      expect(draftField).toBe(serverField)
    }
  })
})
