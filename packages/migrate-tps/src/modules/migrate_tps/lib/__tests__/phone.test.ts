import { formatTpsPhone } from '../phone'

describe('formatTpsPhone', () => {
  it('preserves country-code digits already present in the TPS phone value', () => {
    expect(formatTpsPhone('67506723', '+852')).toBe('+852 67506723')
    expect(formatTpsPhone('85267506723', '+852')).toBe('+852 85267506723')
  })

  it('removes separators without changing the source digits', () => {
    expect(formatTpsPhone('+852 6750-6723', '+852')).toBe('+852 85267506723')
  })
})
