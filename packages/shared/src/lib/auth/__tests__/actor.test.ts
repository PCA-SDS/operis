import { resolveAuthActorId } from '../actor'
import type { AuthContext } from '../server'

function auth(fields: Partial<NonNullable<AuthContext>>): AuthContext {
  return { sub: '', tenantId: 't1', orgId: 'o1', ...fields } as AuthContext
}

describe('resolveAuthActorId', () => {
  it('prefers the user, then the user id, then the API key', () => {
    expect(resolveAuthActorId(auth({ sub: 'user-1', userId: 'user-2', keyId: 'key-1' }))).toBe('user-1')
    expect(resolveAuthActorId(auth({ sub: '  ', userId: 'user-2', keyId: 'key-1' }))).toBe('user-2')
    expect(resolveAuthActorId(auth({ sub: '', keyId: 'key-1' }))).toBe('key-1')
  })

  it('falls back to system', () => {
    expect(resolveAuthActorId(null)).toBe('system')
    expect(resolveAuthActorId(undefined)).toBe('system')
    expect(resolveAuthActorId(auth({ sub: '' }))).toBe('system')
  })
})
