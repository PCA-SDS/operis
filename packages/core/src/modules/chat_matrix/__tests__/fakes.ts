import type { EntityManager } from '@mikro-orm/postgresql'
import type { MatrixClient, MatrixConfig } from '@open-mercato/matrix'

/**
 * Just enough EntityManager and MatrixClient to test decisions rather than the
 * ORM. Anything these fakes do not implement is something the code under test
 * should not be doing.
 */

export const testConfig: MatrixConfig = {
  baseUrl: 'http://127.0.0.1:8008',
  serverName: 'operis.local',
  asToken: 'a'.repeat(64),
  senderLocalpart: 'operis',
  userPrefix: 'om_',
  botLocalpart: 'om_bot',
}

export const BOT = '@om_bot:operis.local'

type Row = Record<string, unknown>

export class FakeEntityManager {
  /** Rows keyed by entity constructor, in insertion order. */
  readonly rows = new Map<unknown, Row[]>()
  /** Set to make the next flush reject with a unique violation. */
  failNextFlushWithUniqueViolation = false
  /** Rows another process "inserted" — returned by the post-violation re-read. */
  readonly racedRows = new Map<unknown, Row[]>()
  flushes = 0

  private pending: Array<{ entity: unknown; row: Row }> = []

  private bucket(entity: unknown): Row[] {
    const existing = this.rows.get(entity)
    if (existing) return existing
    const created: Row[] = []
    this.rows.set(entity, created)
    return created
  }

  seed(entity: unknown, row: Row): void {
    this.bucket(entity).push(row)
  }

  seedRaced(entity: unknown, row: Row): void {
    const existing = this.racedRows.get(entity) ?? []
    existing.push(row)
    this.racedRows.set(entity, existing)
  }

  async findOne(entity: unknown, where: Row): Promise<Row | null> {
    const match = (rows: Row[]) =>
      rows.find((row) =>
        Object.entries(where).every(([key, value]) => value === undefined || row[key] === value),
      ) ?? null
    return match(this.bucket(entity))
  }

  create(entity: unknown, data: Row): Row {
    return { ...data, __entity: entity }
  }

  persist(row: Row): void {
    this.pending.push({ entity: row.__entity, row })
  }

  remove(row: Row): void {
    for (const rows of this.rows.values()) {
      const index = rows.indexOf(row)
      if (index >= 0) rows.splice(index, 1)
    }
  }

  async flush(): Promise<void> {
    this.flushes += 1
    if (this.failNextFlushWithUniqueViolation) {
      this.failNextFlushWithUniqueViolation = false
      this.pending = []
      // The shape `isUniqueViolation` recognises.
      const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      })
      throw error
    }
    for (const { entity, row } of this.pending) this.bucket(entity).push(row)
    this.pending = []
  }

  /** The post-race re-read reaches for a fork; it sees what the winner wrote. */
  fork(): FakeEntityManager {
    const forked = new FakeEntityManager()
    for (const [entity, rows] of this.rows) forked.rows.set(entity, [...rows])
    for (const [entity, rows] of this.racedRows) {
      forked.rows.set(entity, [...(forked.rows.get(entity) ?? []), ...rows])
    }
    return forked
  }

  asEntityManager(): EntityManager {
    return this as unknown as EntityManager
  }
}

export type ClientCall = { method: string; args: unknown[] }

export class FakeMatrixClient {
  readonly calls: ClientCall[] = []
  readonly registered = new Set<string>()
  joinedByRoom: Record<string, Record<string, unknown>> = {}
  nextRoomId = '!room:operis.local'
  nextEventId = '$event'
  failOn: string | null = null

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
    if (this.failOn === method) throw new Error(`fake failure in ${method}`)
  }

  callsTo(method: string): ClientCall[] {
    return this.calls.filter((call) => call.method === method)
  }

  async registerUser(localpart: string): Promise<void> {
    this.record('registerUser', [localpart])
    this.registered.add(localpart)
  }

  async setDisplayName(userId: string, displayName: string): Promise<void> {
    this.record('setDisplayName', [userId, displayName])
  }

  async createRoom(options: unknown, asUser: string): Promise<{ room_id: string }> {
    this.record('createRoom', [options, asUser])
    return { room_id: this.nextRoomId }
  }

  async joinedMembers(roomId: string, asUser: string): Promise<{ joined: Record<string, unknown> }> {
    this.record('joinedMembers', [roomId, asUser])
    return { joined: this.joinedByRoom[roomId] ?? {} }
  }

  async invite(roomId: string, userId: string, asUser: string): Promise<void> {
    this.record('invite', [roomId, userId, asUser])
  }

  async join(roomId: string, asUser: string): Promise<{ room_id: string }> {
    this.record('join', [roomId, asUser])
    return { room_id: roomId }
  }

  async sendEvent(params: Record<string, unknown>): Promise<{ event_id: string }> {
    this.record('sendEvent', [params])
    return { event_id: this.nextEventId }
  }

  async redact(params: Record<string, unknown>): Promise<{ event_id: string }> {
    this.record('redact', [params])
    return { event_id: '$redaction' }
  }

  asClient(): MatrixClient {
    return this as unknown as MatrixClient
  }
}
