import { ensureIdentity } from '../lib/identities'
import { ChatMatrixIdentity } from '../data/entities'
import { BOT, FakeEntityManager, FakeMatrixClient, testConfig } from './fakes'

const TENANT = '11111111-1111-4111-8111-111111111111'
const USER = '64097a24-ecb4-4795-80c2-bb466858f186'
const USER_MXID = '@om_u_64097a24ecb4479580c2bb466858f186:operis.local'

function deps() {
  const em = new FakeEntityManager()
  const client = new FakeMatrixClient()
  return { em, client, deps: { em: em.asEntityManager(), client: client.asClient(), config: testConfig } }
}

describe('ensureIdentity', () => {
  it('returns an existing mapping without touching the homeserver', async () => {
    const { em, client, deps: d } = deps()
    em.seed(ChatMatrixIdentity, { tenantId: TENANT, userId: USER, mxid: USER_MXID, displayName: null })

    await expect(ensureIdentity(d, TENANT, USER)).resolves.toBe(USER_MXID)
    expect(client.calls).toHaveLength(0)
  })

  it('registers the account before writing the row', async () => {
    // Order matters: a row written first would claim an account the homeserver
    // does not have, and every later send would trust the mapping and fail.
    const { em, client, deps: d } = deps()

    await expect(ensureIdentity(d, TENANT, USER)).resolves.toBe(USER_MXID)
    expect(client.callsTo('registerUser')[0].args[0]).toBe('om_u_64097a24ecb4479580c2bb466858f186')
    expect(em.rows.get(ChatMatrixIdentity)).toHaveLength(1)
  })

  it('sets the display name when one is supplied', async () => {
    const { client, deps: d } = deps()
    await ensureIdentity(d, TENANT, USER, 'Bao Nguyen')
    expect(client.callsTo('setDisplayName')[0].args).toEqual([USER_MXID, 'Bao Nguyen'])
  })

  it('does not re-push an unchanged display name', async () => {
    const { em, client, deps: d } = deps()
    em.seed(ChatMatrixIdentity, {
      tenantId: TENANT,
      userId: USER,
      mxid: USER_MXID,
      displayName: 'Bao Nguyen',
    })
    await ensureIdentity(d, TENANT, USER, 'Bao Nguyen')
    expect(client.callsTo('setDisplayName')).toHaveLength(0)
  })

  it('pushes a changed display name', async () => {
    const { em, client, deps: d } = deps()
    em.seed(ChatMatrixIdentity, {
      tenantId: TENANT,
      userId: USER,
      mxid: USER_MXID,
      displayName: 'Old Name',
    })
    await ensureIdentity(d, TENANT, USER, 'New Name')
    expect(client.callsTo('setDisplayName')[0].args[1]).toBe('New Name')
  })

  it('resolves a concurrent creator by re-reading rather than failing', async () => {
    // Both racers derive the same mxid — the derivation is a pure function of
    // the user id — so the winner's row is as good as ours.
    const { em, deps: d } = deps()
    em.failNextFlushWithUniqueViolation = true
    em.seedRaced(ChatMatrixIdentity, { tenantId: TENANT, userId: USER, mxid: USER_MXID })

    await expect(ensureIdentity(d, TENANT, USER)).resolves.toBe(USER_MXID)
  })

  it('rethrows a unique violation with no winner to find', async () => {
    // Not a race then — something else is wrong, and swallowing it would return
    // an mxid for a mapping that does not exist.
    const { em, deps: d } = deps()
    em.failNextFlushWithUniqueViolation = true

    await expect(ensureIdentity(d, TENANT, USER)).rejects.toThrow()
  })

  it('refuses a user id that is not a uuid', async () => {
    const { deps: d } = deps()
    await expect(ensureIdentity(d, TENANT, 'not-a-uuid')).rejects.toThrow(/UUID/)
  })

  it('never derives an identity outside the namespace', async () => {
    const { client, deps: d } = deps()
    await ensureIdentity(d, TENANT, USER)
    const localpart = client.callsTo('registerUser')[0].args[0] as string
    expect(localpart.startsWith(testConfig.userPrefix)).toBe(true)
    expect(`@${localpart}:${testConfig.serverName}`).not.toBe(BOT)
  })
})
