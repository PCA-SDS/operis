import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { RFC4122_UUID_PATTERN } from '@open-mercato/shared/lib/validation'

export function resolveLabelActorUserId(auth: AuthContext): string | null {
  if (!auth) return null

  const apiUserId = typeof auth.userId === 'string' ? auth.userId.trim() : ''
  if (apiUserId && RFC4122_UUID_PATTERN.test(apiUserId)) {
    return apiUserId
  }

  if (auth.isApiKey) {
    return null
  }

  const subjectId = typeof auth.sub === 'string' ? auth.sub.trim() : ''
  return subjectId && RFC4122_UUID_PATTERN.test(subjectId) ? subjectId : null
}
