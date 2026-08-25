/** @jest-environment node */

import { mapErpClientStatusToOperis } from '../personLookup'

describe('mapErpClientStatusToOperis', () => {
  it('maps prospect to lifecycleStage prospect', () => {
    expect(mapErpClientStatusToOperis('prospect')).toEqual({
      lifecycleStage: 'prospect',
      status: 'prospect',
    })
  })

  it('maps active to customer lifecycle and active status', () => {
    expect(mapErpClientStatusToOperis('active')).toEqual({
      lifecycleStage: 'customer',
      status: 'active',
    })
  })

  it('defaults unknown values to prospect', () => {
    expect(mapErpClientStatusToOperis(undefined)).toEqual({
      lifecycleStage: 'prospect',
      status: 'prospect',
    })
  })
})
