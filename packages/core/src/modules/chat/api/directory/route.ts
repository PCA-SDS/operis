import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatDirectoryQuerySchema } from '../../data/validators'
import { searchOrganizationDirectory } from '../../lib/directory'
import { chatDirectoryRateLimit } from '../../lib/rateLimits'
import { loadOrganizationMember } from '../../lib/scope'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  searchParamsToObject,
  toChatErrorResponse,
} from '../shared'
import { CHAT_TAG, COMMON_ERRORS, directoryResponseSchema, RATE_LIMITED_ERRORS } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
}

/**
 * People in the caller's own organization they can start a conversation with.
 *
 * Scope comes from the session, so there is no request shape that widens it to
 * another organization or another tenant — the endpoint cannot be used to
 * enumerate anyone the caller could not already see in the staff directory.
 */
export async function GET(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatDirectoryRateLimit, { failClosed: false })
    if (limited) return limited

    // A caller who is not a member of the organization they are scoped into gets
    // an empty directory rather than someone else's colleagues.
    const caller = await loadOrganizationMember(request.em, request.scope, request.userId)
    if (!caller) return jsonOk({ items: [], truncated: false })

    const query = chatDirectoryQuerySchema.parse(searchParamsToObject(req.url))
    const result = await searchOrganizationDirectory(request.em, request.scope, {
      query: query.q ?? '',
      excludeUserId: request.userId,
      limit: query.limit,
    })
    return jsonOk(result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.directory')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'People you can chat with',
  methods: {
    GET: {
      summary: 'Search the caller’s organization directory',
      description:
        'Active, confirmed users of the caller’s own organization, excluding the caller. Matches display name, work email or role name. Never crosses an organization or tenant boundary.',
      responses: [
        { status: 200, description: 'Matching colleagues.', schema: directoryResponseSchema },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
