/**
 * Free/busy boundary for the conflicts endpoint.
 *
 * The endpoint accepts a `userId`, so it can answer "is this assignee free?" —
 * which a double-booking warning needs. It must answer that WITHOUT handing back
 * the subject line of a colleague's meeting, or it becomes a way to read any
 * calendar one slot at a time, bypassing the personal scope on the list route.
 */
import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const callerId = '33333333-3333-4333-8333-333333333333'
const colleagueId = '44444444-4444-4444-8444-444444444444'

type ConflictRow = {
  id: string
  scheduled_at: string
  duration_minutes: number | null
  interaction_type: string
  author_user_id: string | null
  owner_user_id: string | null
  participants: unknown
}

let rowsToReturn: ConflictRow[] = []
let grantedFeatures: string[] = []

function createRecordingKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (_compiled: CompiledQuery) => ({ rows: rowsToReturn })
  return db
}

const fakeEm = { fork: () => ({ getKysely: () => createRecordingKysely() }) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'em') return fakeEm
      if (token === 'rbacService') return { getGrantedFeatures: async () => grantedFeatures }
      return undefined
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    tenantId,
    orgId,
    sub: callerId,
    userId: callerId,
    isApiKey: false,
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ filterIds: [orgId], selectedId: orgId }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

// Stands in for the decryption round-trip: every id it is asked for comes back
// with a title, so a redacted title can only be the route's own doing.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (_em: unknown, _entity: unknown, filter: any) => {
    const ids: string[] = filter?.id?.$in ?? []
    return ids.map((id) => ({ id, title: `secret-${id}` }))
  },
}))

import { GET } from '../route'

const url = (params: Record<string, string>) =>
  `http://localhost/api/customers/interactions/conflicts?${new URLSearchParams({
    date: '2026-09-24',
    startTime: '14:00',
    duration: '60',
    ...params,
  }).toString()}`

const busyRow = (over: Partial<ConflictRow> = {}): ConflictRow => ({
  id: '55555555-5555-4555-8555-555555555555',
  scheduled_at: '2026-09-24T14:00:00.000Z',
  duration_minutes: 30,
  interaction_type: 'meeting',
  author_user_id: colleagueId,
  owner_user_id: colleagueId,
  participants: [],
  ...over,
})

async function conflictsFor(params: Record<string, string>) {
  const res = await GET(new Request(url(params)))
  const body = await res.json()
  return body?.result?.conflicts ?? []
}

beforeEach(() => {
  rowsToReturn = []
  grantedFeatures = ['customers.interactions.view']
})

describe('conflicts endpoint free/busy boundary', () => {
  it('still reports the clash when checking a colleague, but without the title', async () => {
    rowsToReturn = [busyRow()]
    const conflicts = await conflictsFor({ userId: colleagueId })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].startTime).toBeTruthy()
    expect(conflicts[0].title).toBeNull()
  })

  it('keeps the title when the caller is a participant of the colleague’s meeting', async () => {
    rowsToReturn = [busyRow({ participants: [{ userId: callerId }] })]
    const conflicts = await conflictsFor({ userId: colleagueId })
    expect(conflicts[0].title).toBe(`secret-${rowsToReturn[0].id}`)
  })

  it('keeps the title when the caller owns the row', async () => {
    rowsToReturn = [busyRow({ owner_user_id: callerId })]
    const conflicts = await conflictsFor({ userId: colleagueId })
    expect(conflicts[0].title).toBe(`secret-${rowsToReturn[0].id}`)
  })

  it('keeps the title for a holder of the oversight feature', async () => {
    grantedFeatures = ['customers.interactions.view_all']
    rowsToReturn = [busyRow()]
    const conflicts = await conflictsFor({ userId: colleagueId })
    expect(conflicts[0].title).toBe(`secret-${rowsToReturn[0].id}`)
  })

  it('honours a wildcard grant the same way', async () => {
    grantedFeatures = ['customers.*']
    rowsToReturn = [busyRow()]
    const conflicts = await conflictsFor({ userId: colleagueId })
    expect(conflicts[0].title).toBe(`secret-${rowsToReturn[0].id}`)
  })

  it('leaves the self-check untouched', async () => {
    rowsToReturn = [busyRow({ author_user_id: callerId, owner_user_id: callerId })]
    const conflicts = await conflictsFor({})
    expect(conflicts[0].title).toBe(`secret-${rowsToReturn[0].id}`)
  })
})
