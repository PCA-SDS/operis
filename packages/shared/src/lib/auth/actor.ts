import type { AuthContext } from './server'

/**
 * The id to record as the actor of a change: the user, else the API key, else
 * `'system'`. Blank ids are skipped so a malformed token cannot attribute a
 * write to an empty actor.
 */
export function resolveAuthActorId(auth: AuthContext | null | undefined): string {
  if (auth && typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (auth && typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (auth && typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}
