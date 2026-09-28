import { tryResolve } from '../tryResolve'

describe('tryResolve', () => {
  it('returns the registration or null when it is missing', () => {
    const service = { ok: true }
    const container = {
      resolve: (name: string) => {
        if (name === 'present') return service
        throw new Error(`Could not resolve '${name}'`)
      },
    }
    expect(tryResolve<typeof service>(container, 'present')).toBe(service)
    expect(tryResolve(container, 'absent')).toBeNull()
  })
})
