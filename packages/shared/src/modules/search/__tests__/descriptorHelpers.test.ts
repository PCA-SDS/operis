import type { SearchBuildContext, SearchResultPresenter } from '../../search'
import { friendlyFieldLabel, readRecordText, toIndexSource } from '../descriptorHelpers'

describe('search descriptor helpers', () => {
  it('reads the first non-blank normalized field', () => {
    expect(readRecordText({ a: '  ', b: 5, c: 'x' }, 'a', 'b', 'c')).toBe('5')
    expect(readRecordText({ a: null }, 'a', 'missing')).toBeNull()
  })

  it('turns custom-field keys into readable labels', () => {
    expect(friendlyFieldLabel('cf:delivery_window')).toBe('Delivery Window')
    expect(friendlyFieldLabel('shippingNote')).toBe('Shipping Note')
  })

  it('builds the index source only when there is text', () => {
    const ctx = { record: { id: 'r1' }, customFields: { color: 'red' } } as unknown as SearchBuildContext
    const presenter = { title: 'R1' } as SearchResultPresenter
    expect(toIndexSource(ctx, presenter, [])).toBeNull()
    expect(toIndexSource(ctx, presenter, ['Name: R1'])).toEqual({
      text: ['Name: R1'],
      presenter,
      checksumSource: { record: { id: 'r1' }, customFields: { color: 'red' } },
    })
  })
})
