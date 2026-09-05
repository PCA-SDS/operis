import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ChatUserSettings } from '../../data/entities'
import { chatSetLocaleSchema } from '../../data/validators'
import { chatReadCursorRateLimit } from '../../lib/rateLimits'
import type { SetChatLocaleInput } from '../../commands/translation'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['chat.view'] },
  PUT: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const settingsSchema = z.object({ translationLocale: z.string().nullable() })

/**
 * The caller's own chat preferences.
 *
 * Separate from the interface language on purpose. The UI ships in five
 * languages; the languages colleagues write to each other in are not limited to
 * those, and someone reading Vietnamese runs the interface in English because
 * there is no Vietnamese interface. Deriving one from the other would hand them
 * the one language they did not need translating.
 *
 * There is no user parameter on either method — these are always the caller's
 * own settings.
 */
export async function GET(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const em = request.container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const row = await em.findOne(ChatUserSettings, {
      userId: request.auth.sub,
      organizationId: request.scope.organizationId,
      tenantId: request.scope.tenantId,
    })

    return jsonOk({ translationLocale: row?.translationLocale ?? null })
  } catch (error) {
    return toChatErrorResponse(error, 'chat.settings.get')
  }
}

export async function PUT(req: Request) {
  try {
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatReadCursorRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatSetLocaleSchema.parse(await req.json())
    const outcome = await runChatCommand<SetChatLocaleInput, { translationLocale: string | null }>({
      request,
      req,
      commandId: 'chat.settings.setLocale',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        translationLocale: body.translationLocale,
      },
      resourceKind: 'chat.settings',
      resourceId: request.auth.sub,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.settings.setLocale')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Chat preferences',
  methods: {
    GET: {
      summary: "The caller's chat preferences",
      description:
        'Returns the language the caller reads chat in. Null means follow the interface language.',
      responses: [{ status: 200, description: 'The current preference.', schema: settingsSchema }],
      errors: [...COMMON_ERRORS],
    },
    PUT: {
      summary: 'Set the language the caller reads chat in',
      description:
        'Any ISO-639-1 code, not only the five the interface ships in — French and Vietnamese have no interface translation, so deriving a reading language from the UI locale would fail exactly the people who need this. Null clears it.',
      responses: [{ status: 200, description: 'The stored preference.', schema: settingsSchema }],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
