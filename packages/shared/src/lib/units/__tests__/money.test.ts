import { formatCurrency } from '../money'

describe('formatCurrency', () => {
  it('formats an amount in its currency, from a number or a numeric string', () => {
    expect(formatCurrency(1234.5, 'USD', { locale: 'en-US' })).toBe('$1,234.50')
    expect(formatCurrency('1234.5', 'usd', { locale: 'en-US' })).toBe('$1,234.50')
    expect(formatCurrency(' 99 ', ' EUR ', { locale: 'de-DE' })).toBe(new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(99))
    expect(formatCurrency(1000, 'JPY', { locale: 'en-US' })).toBe('¥1,000')
    expect(formatCurrency(5, 'USD', { locale: '' })).toBe(new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(5))
  })

  it('shows two decimals when the currency code is missing or malformed', () => {
    expect(formatCurrency(12.5, null, { locale: 'en-US' })).toBe('12.50')
    expect(formatCurrency(12.5, undefined, { locale: 'en-US' })).toBe('12.50')
    expect(formatCurrency(12.5, 'dollars', { locale: 'en-US' })).toBe('12.50')
  })

  it('returns the fallback, null by default, for an empty or non-numeric amount', () => {
    expect(formatCurrency(null, 'USD')).toBeNull()
    expect(formatCurrency(undefined, 'USD')).toBeNull()
    expect(formatCurrency('', 'USD')).toBeNull()
    expect(formatCurrency('abc', 'USD')).toBeNull()
    expect(formatCurrency(Number.NaN, 'USD')).toBeNull()
    expect(formatCurrency(null, 'USD', { fallback: '—' })).toBe('—')
  })
})
