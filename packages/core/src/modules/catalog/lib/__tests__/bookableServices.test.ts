/** @jest-environment node */

import { selectBestPrice, type PricingContext } from '../pricing'
import {
  BOOKABLE_DURATION_FIELD_KEY,
  BOOKABLE_SERVICE_FIELDSET,
} from '../bookableServices'

describe('bookableServices constants', () => {
  it('uses the catalog service_schedule fieldset and duration CF key', () => {
    expect(BOOKABLE_SERVICE_FIELDSET).toBe('service_schedule')
    expect(BOOKABLE_DURATION_FIELD_KEY).toBe('service_duration_minutes')
  })
})

describe('bookable service price fallback', () => {
  const ctx: PricingContext = { channelId: null, quantity: 1, date: new Date() }

  it('selectBestPrice skips channel-bound rows when no channel is provided', () => {
    const channelBound = {
      id: 'p1',
      channelId: 'channel-1',
      minQuantity: 1,
      kind: 'regular',
      currencyCode: 'USD',
      unitPriceNet: '100',
      unitPriceGross: '100',
    } as any
    const unscoped = {
      id: 'p2',
      channelId: null,
      offer: null,
      minQuantity: 1,
      kind: 'regular',
      currencyCode: 'USD',
      unitPriceNet: '90',
      unitPriceGross: '90',
    } as any

    expect(selectBestPrice([channelBound], ctx)).toBeNull()
    expect(selectBestPrice([channelBound, unscoped], ctx)?.id).toBe('p2')
  })
})
