import { readBooleanEnv, readEnvValue } from '../env'

describe('env readers', () => {
  it('returns the first non-blank value, trimmed', () => {
    expect(readEnvValue({ A: '  ', B: ' value ' }, ['A', 'B'])).toBe('value')
    expect(readEnvValue({}, ['A'])).toBeUndefined()
  })

  it('returns the first recognisable boolean token', () => {
    expect(readBooleanEnv({ A: 'maybe', B: 'yes' }, ['A', 'B'])).toBe(true)
    expect(readBooleanEnv({ A: 'off' }, ['A'])).toBe(false)
    expect(readBooleanEnv({ A: '' }, ['A'])).toBeUndefined()
  })
})
