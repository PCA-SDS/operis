import { matrixConfigFromEnv, resolveMatrixConfig } from '../config'
import { MatrixConfigError } from '../errors'

const valid = {
  homeserverUrl: 'http://127.0.0.1:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
}

describe('resolveMatrixConfig', () => {
  it('applies the documented defaults', () => {
    const config = resolveMatrixConfig(valid)
    expect(config.senderLocalpart).toBe('operis')
    expect(config.userPrefix).toBe('om_')
    expect(config.botLocalpart).toBe('om_bot')
  })

  it('strips a trailing slash so path concatenation is unambiguous', () => {
    expect(resolveMatrixConfig({ ...valid, homeserverUrl: 'http://127.0.0.1:8008/' }).baseUrl).toBe(
      'http://127.0.0.1:8008',
    )
  })

  it('rejects a token that is too short to be a real one', () => {
    expect(() => resolveMatrixConfig({ ...valid, asToken: 'short' })).toThrow(MatrixConfigError)
  })

  describe('homeserver URL guard', () => {
    it.each([
      ['localhost', 'http://localhost:8008'],
      ['a loopback address', 'http://127.0.0.1:8008'],
      ['a docker service name', 'http://synapse:8008'],
      ['a private range', 'http://10.1.2.3:8008'],
    ])('allows plain http for %s', (_label, homeserverUrl) => {
      expect(() => resolveMatrixConfig({ ...valid, homeserverUrl })).not.toThrow()
    })

    it('refuses plain http for a publicly resolvable host', () => {
      expect(() => resolveMatrixConfig({ ...valid, homeserverUrl: 'http://matrix.example.com' })).toThrow(
        /https/,
      )
    })

    it('allows https anywhere', () => {
      expect(() =>
        resolveMatrixConfig({ ...valid, homeserverUrl: 'https://matrix.example.com' }),
      ).not.toThrow()
    })

    it.each([
      ['a non-http scheme', 'file:///etc/passwd'],
      ['embedded credentials', 'https://user:pass@matrix.example.com'],
      ['a query string', 'https://matrix.example.com?a=1'],
      ['garbage', 'not a url'],
    ])('refuses %s', (_label, homeserverUrl) => {
      expect(() => resolveMatrixConfig({ ...valid, homeserverUrl })).toThrow(MatrixConfigError)
    })
  })

  describe('localpart rules', () => {
    it('refuses a bot that equals the appservice sender', () => {
      // Synapse refuses /sync for the appservice's own sender (matrix-doc#1144),
      // so this configuration produces a homeserver that accepts every write
      // and can never read anything back.
      expect(() =>
        resolveMatrixConfig({ ...valid, senderLocalpart: 'op', userPrefix: 'op', botLocalpart: 'op' }),
      ).toThrow(/sync/)
    })

    it('refuses a bot outside the exclusive namespace', () => {
      expect(() => resolveMatrixConfig({ ...valid, botLocalpart: 'helper' })).toThrow(/userPrefix/)
    })

    it('refuses characters that are illegal in a Matrix localpart', () => {
      expect(() => resolveMatrixConfig({ ...valid, userPrefix: 'OM_' })).toThrow(MatrixConfigError)
    })

    it('names the offending field on the error', () => {
      try {
        resolveMatrixConfig({ ...valid, botLocalpart: 'helper' })
        throw new Error('expected a refusal')
      } catch (error) {
        expect((error as MatrixConfigError).field).toBe('botLocalpart')
      }
    })
  })
})

describe('matrixConfigFromEnv', () => {
  it('returns null when Matrix is simply not configured', () => {
    // The overwhelmingly common case while the transport is behind a flag.
    expect(matrixConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('builds a config from OM_MATRIX_* variables', () => {
    const config = matrixConfigFromEnv({
      OM_MATRIX_HOMESERVER_URL: 'http://127.0.0.1:8008',
      OM_MATRIX_SERVER_NAME: 'operis.local',
      OM_MATRIX_AS_TOKEN: 'a'.repeat(64),
    } as NodeJS.ProcessEnv)
    expect(config?.serverName).toBe('operis.local')
    expect(config?.botLocalpart).toBe('om_bot')
  })

  it('throws on a half-configured environment rather than silently disabling', () => {
    // A missing token next to a present URL is a mistake, not a choice.
    expect(() =>
      matrixConfigFromEnv({
        OM_MATRIX_HOMESERVER_URL: 'http://127.0.0.1:8008',
      } as NodeJS.ProcessEnv),
    ).toThrow(MatrixConfigError)
  })
})
