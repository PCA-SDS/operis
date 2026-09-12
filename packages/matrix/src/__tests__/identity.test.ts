import {
  assertMasqueradable,
  botMxid,
  isOwnedIdentity,
  localpartForUser,
  mxidForUser,
  operisUserIdFromMxid,
  parseMxid,
  senderMxid,
  type MatrixIdentityConfig,
} from '../identity'
import { MatrixNamespaceError } from '../errors'

const config: MatrixIdentityConfig = {
  serverName: 'operis.local',
  userPrefix: 'om_',
  senderLocalpart: 'operis',
  botLocalpart: 'om_bot',
}

const USER_ID = '64097a24-ecb4-4795-80c2-bb466858f186'
const USER_MXID = '@om_u_64097a24ecb4479580c2bb466858f186:operis.local'

describe('parseMxid', () => {
  it('splits a well-formed id', () => {
    expect(parseMxid(USER_MXID)).toEqual({
      userId: USER_MXID,
      localpart: 'om_u_64097a24ecb4479580c2bb466858f186',
      serverName: 'operis.local',
    })
  })

  it('accepts a server name carrying a port', () => {
    expect(parseMxid('@a:operis.local:8448')?.serverName).toBe('operis.local:8448')
  })

  it.each([
    ['no leading sigil', 'om_u_x:operis.local'],
    ['no domain', '@om_u_x'],
    ['uppercase in the localpart', '@OM_U_X:operis.local'],
    ['empty', ''],
  ])('returns null for %s', (_label, input) => {
    expect(parseMxid(input)).toBeNull()
  })
})

describe('localpartForUser', () => {
  it('is deterministic and dash-free', () => {
    expect(localpartForUser(config, USER_ID)).toBe('om_u_64097a24ecb4479580c2bb466858f186')
  })

  it('lowercases, because a Matrix localpart may not carry uppercase', () => {
    expect(localpartForUser(config, USER_ID.toUpperCase())).toBe(
      'om_u_64097a24ecb4479580c2bb466858f186',
    )
  })

  it.each([
    ['an arbitrary string', 'not-a-uuid'],
    ['an empty string', ''],
    ['a truncated uuid', '64097a24-ecb4-4795-80c2'],
    // Guarding this matters: an injected value reaching the localpart could
    // escape the namespace, which is the one thing assertMasqueradable exists
    // to prevent.
    ['an injection attempt', '@admin:operis.local'],
  ])('refuses %s', (_label, input) => {
    expect(() => localpartForUser(config, input)).toThrow(MatrixNamespaceError)
  })
})

describe('operisUserIdFromMxid', () => {
  it('round-trips with mxidForUser', () => {
    expect(operisUserIdFromMxid(config, mxidForUser(config, USER_ID))).toBe(USER_ID)
  })

  it('reconstructs the canonical dashed form', () => {
    expect(operisUserIdFromMxid(config, USER_MXID)).toBe(USER_ID)
  })

  it.each([
    ['the appservice sender', '@operis:operis.local'],
    ['the sync bot', '@om_bot:operis.local'],
    ['a namespaced non-user identity', '@om_bridge_wa_123:operis.local'],
    ['a foreign homeserver', '@om_u_64097a24ecb4479580c2bb466858f186:elsewhere.example'],
    ['a real account', '@alice:operis.local'],
  ])('returns null for %s rather than throwing', (_label, input) => {
    expect(operisUserIdFromMxid(config, input)).toBeNull()
  })
})

describe('ownership', () => {
  it('claims every localpart under the prefix', () => {
    expect(isOwnedIdentity(config, USER_MXID)).toBe(true)
    expect(isOwnedIdentity(config, botMxid(config))).toBe(true)
  })

  it('claims its own sender', () => {
    expect(isOwnedIdentity(config, senderMxid(config))).toBe(true)
  })

  it('disclaims an account outside the prefix', () => {
    expect(isOwnedIdentity(config, '@alice:operis.local')).toBe(false)
  })

  it('disclaims a matching localpart on another homeserver', () => {
    // Without the server-name check this would pass, and the appservice would
    // try to act on a homeserver it has no registration with.
    expect(isOwnedIdentity(config, '@om_u_abc:elsewhere.example')).toBe(false)
  })
})

describe('assertMasqueradable', () => {
  it('returns the id it was given when ownership holds', () => {
    expect(assertMasqueradable(config, USER_MXID)).toBe(USER_MXID)
  })

  it('throws for an identity outside the namespace', () => {
    expect(() => assertMasqueradable(config, '@alice:operis.local')).toThrow(MatrixNamespaceError)
  })

  it('reports the offending id on the error, for the log line', () => {
    try {
      assertMasqueradable(config, '@alice:operis.local')
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(MatrixNamespaceError)
      expect((error as MatrixNamespaceError).userId).toBe('@alice:operis.local')
    }
  })
})
