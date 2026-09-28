import type { EntityManager } from '@mikro-orm/postgresql'

export function forkSubscriberEntityManager(em: EntityManager): EntityManager {
  const fork = (em as unknown as { fork?: (options?: Record<string, unknown>) => EntityManager }).fork
  if (typeof fork !== 'function') return em
  return fork.call(em, { clear: true, freshEventManager: true, useContext: false })
}
