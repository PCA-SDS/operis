import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatTranslateSchema } from '../../../../data/validators'
import { chatSendRateLimit } from '../../../../lib/rateLimits'
import type { TranslateMessagesInput, TranslatedMessage } from '../../../../commands/translation'
import {
  enforceChatRateLimit,
  jsonOk,
  resolveChatRequest,
  runChatCommand,
  toChatErrorResponse,
} from '../../../shared'
import { CHAT_TAG, COMMON_ERRORS, RATE_LIMITED_ERRORS } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['chat.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Translate messages in a conversation into one language.
 *
 * Takes a set of ids rather than a single message, because the conversation-wide
 * control asks for a whole page at once and a request per message would be
 * thirty round trips to read one thread.
 *
 * Gated on `chat.view`, not `chat.send`: reading a message in your own language
 * is reading, not writing. The row this persists is a cache of what the message
 * already says, not new content, and it is shared by everyone who reads in that
 * language.
 *
 * Metered on the send bucket even so — it is the one read here that costs real
 * compute on the engine, so it is as spammable as a message.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatSendRateLimit, { failClosed: true })
    if (limited) return limited

    const body = chatTranslateSchema.parse(await req.json())
    const outcome = await runChatCommand<TranslateMessagesInput, { translations: TranslatedMessage[] }>({
      request,
      req,
      commandId: 'chat.messages.translate',
      input: {
        tenantId: request.scope.tenantId,
        organizationId: request.scope.organizationId,
        conversationId: id,
        messageIds: body.messageIds,
        targetLocale: body.targetLocale,
      },
      resourceKind: 'chat.conversation',
      resourceId: id,
      operation: 'update',
    })
    if (!outcome.ok) return outcome.response

    return jsonOk(outcome.result)
  } catch (error) {
    return toChatErrorResponse(error, 'chat.messages.translate')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: CHAT_TAG,
  summary: 'Translate messages',
  methods: {
    POST: {
      summary: 'Translate messages into a language',
      description:
        'Returns a translation per requested message, served from cache where one exists and produced by the engine otherwise. Translations are keyed by message and language and shared between readers. A message already in the target language, one with nothing translatable in it, and one the engine could not handle are each reported distinctly rather than returned as unchanged text. The caller must be a member of the conversation and every message must belong to it; a forged id from another conversation or organization is a 404, and a composite foreign key makes the row unstorable regardless.',
      responses: [
        {
          status: 200,
          description: 'One entry per requested message.',
          schema: z.object({
            translations: z.array(
              z.object({
                messageId: z.string().uuid(),
                body: z.string().nullable(),
                sourceLocale: z.string().nullable(),
                cached: z.boolean(),
                skipped: z
                  .enum(['same-language', 'nothing-to-translate', 'unavailable', 'failed'])
                  .optional(),
              }),
            ),
          }),
        },
      ],
      errors: [...COMMON_ERRORS, ...RATE_LIMITED_ERRORS],
    },
  },
}
