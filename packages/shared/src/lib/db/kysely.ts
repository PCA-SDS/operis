import type { EntityManager } from '@mikro-orm/postgresql'
import type { Kysely } from 'kysely'

/** The Kysely instance behind a MikroORM `EntityManager`, for queries the ORM cannot express. */
export function getKysely(em: EntityManager): Kysely<any> {
  return (em as unknown as { getKysely: () => Kysely<any> }).getKysely()
}
