import type { EntityManager } from '@mikro-orm/postgresql'
import { getKysely } from '../kysely'

describe('getKysely', () => {
  it('returns the Kysely instance behind the entity manager', () => {
    const kysely = { selectFrom: jest.fn() }
    const em = { getKysely: () => kysely } as unknown as EntityManager
    expect(getKysely(em)).toBe(kysely)
  })
})
