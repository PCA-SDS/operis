import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { chatTranslateSchema } from '../../../../data/validators'
import { chatTranslateRateLimit } from '../../../../lib/rateLimits'
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
 * Metered on its own bucket, not the send one. It is the one read in the module
 * that costs real compute, so it has to be metered — but billing it to the send
 * quota meant scrolling back through a translated conversation could lock the
 * reader out of replying, which is a read gesture taking away a write.
 */
export async function POST(req: Request, context: { params?: Record<string, unknown> }) {
  try {
    const { id } = paramsSchema.parse(context.params)
    const resolved = await resolveChatRequest(req)
    if (!resolved.ok) return resolved.response
    const request = resolved.value

    const limited = await enforceChatRateLimit(request, chatTranslateRateLimit, { failClosed: true })
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
        'Returns a translation per requested message, served from cache where one exists and produced by the engine otherwise. Translations are keyed by message and language and shared between readers. A message already in the target language, one with nothing translatable in it, and one the engine could not handle are each reported distinctly rather than returned as unchanged text. The caller must be a member of the conversation and every message must belong to it; a forged id from another conversation, organization or tenant is a 404, and a four-column foreign key on (message, conversation, tenant, organization) makes the row unstorable regardless. Mentions are never sent to the engine: the body is split at them and the runs between are translated, so an identifier cannot be dropped, reordered or invented.',
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
                  .enum([
                    'same-language',
                    'nothing-to-translate',
                    'unsupported-language',
                    'detection-declined',
                    'unavailable',
                    'overloaded',
                    'deadline-exceeded',
                    'mentions-unsafe',
                    'failed',
                  ])
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
