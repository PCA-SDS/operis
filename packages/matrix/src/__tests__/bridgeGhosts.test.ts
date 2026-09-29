import { matrixConfigFromEnv, parseBridgeGhosts, resolveMatrixConfig } from '../config'
import { MatrixConfigError } from '../errors'
import { bridgeGhostNetwork } from '../identity'

/**
 * Which senders may be outsiders.
 *
 * Empty by default, so nothing changes until an operator names a bridge — and
 * validated so a prefix can never reach into the Operis namespace, where it
 * would turn a colleague, the sender or the bot into an "outsider".
 */

const valid = {
  homeserverUrl: 'http://127.0.0.1:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
}

describe('parseBridgeGhosts', () => {
  it.each([undefined, '', '   '])('reads %p as no bridges', (raw) => {
    expect(parseBridgeGhosts(raw)).toEqual([])
  })

  it('reads network=prefix pairs, trimming around them', () => {
    expect(parseBridgeGhosts(' whatsapp=whatsapp_ , telegram=telegram_ ')).toEqual([
      { network: 'whatsapp', prefix: 'whatsapp_' },
      { network: 'telegram', prefix: 'telegram_' },
    ])
  })

  it.each(['whatsapp', '=whatsapp_', 'whatsapp='])('refuses the malformed pair %p rather than skipping it', (raw) => {
    expect(() => parseBridgeGhosts(raw)).toThrow(MatrixConfigError)
  })
})

describe('resolveMatrixConfig — bridge ghosts', () => {
  it('has none unless named', () => {
    expect(resolveMatrixConfig(valid).bridgeGhosts).toEqual([])
  })

  it('keeps a valid bridge', () => {
    const config = resolveMatrixConfig({ ...valid, bridgeGhosts: [{ network: 'whatsapp', prefix: 'whatsapp_' }] })
    expect(config.bridgeGhosts).toEqual([{ network: 'whatsapp', prefix: 'whatsapp_' }])
  })

  it.each([
    ['a prefix inside the Operis namespace', { network: 'whatsapp', prefix: 'om_wa_' }],
    ['a prefix the Operis namespace sits inside', { network: 'whatsapp', prefix: 'om' }],
    ['a prefix covering the appservice sender', { network: 'whatsapp', prefix: 'oper' }],
    ['a network label that is not a slug', { network: 'WhatsApp', prefix: 'whatsapp_' }],
    ['a prefix a localpart cannot hold', { network: 'whatsapp', prefix: 'WA_' }],
  ])('refuses %s', (_label, ghost) => {
    expect(() => resolveMatrixConfig({ ...valid, bridgeGhosts: [ghost] })).toThrow(MatrixConfigError)
  })

  it('refuses the same prefix twice', () => {
    expect(() =>
      resolveMatrixConfig({
        ...valid,
        bridgeGhosts: [
          { network: 'whatsapp', prefix: 'wa_' },
          { network: 'signal', prefix: 'wa_' },
        ],
      }),
    ).toThrow(MatrixConfigError)
  })

  it('arrives from OM_MATRIX_BRIDGE_GHOSTS', () => {
    const config = matrixConfigFromEnv({
      OM_MATRIX_HOMESERVER_URL: valid.homeserverUrl,
      OM_MATRIX_SERVER_NAME: valid.serverName,
      OM_MATRIX_AS_TOKEN: valid.asToken,
      OM_MATRIX_BRIDGE_GHOSTS: 'whatsapp=whatsapp_',
    } as NodeJS.ProcessEnv)
    expect(config?.bridgeGhosts).toEqual([{ network: 'whatsapp', prefix: 'whatsapp_' }])
  })
})

describe('bridgeGhostNetwork', () => {
  const config = {
    serverName: 'operis.local',
    bridgeGhosts: [
      { network: 'whatsapp', prefix: 'whatsapp_' },
      { network: 'telegram', prefix: 'telegram_' },
    ],
  }

  it.each([
    ['@whatsapp_4915123456789:operis.local', 'whatsapp'],
    ['@telegram_12345:operis.local', 'telegram'],
  ])('names the network %s speaks for', (mxid, network) => {
    expect(bridgeGhostNetwork(config, mxid)).toBe(network)
  })

  it.each([
    ['the bare prefix', '@whatsapp_:operis.local'],
    ["a bridge's own bot", '@whatsappbot:operis.local'],
    ['a ghost on another homeserver', '@whatsapp_4915:elsewhere.example'],
    ['an Operis identity', '@om_u_0123456789abcdef0123456789abcdef:operis.local'],
    ['something that is not an mxid', 'whatsapp_4915'],
  ])('does not treat %s as a ghost', (_label, mxid) => {
    expect(bridgeGhostNetwork(config, mxid)).toBeNull()
  })

  it('treats nobody as a ghost when no bridge is configured', () => {
    expect(bridgeGhostNetwork({ serverName: 'operis.local' }, '@whatsapp_4915:operis.local')).toBeNull()
  })
})
