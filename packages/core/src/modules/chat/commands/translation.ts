import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { getTranslationProvider } from '@open-mercato/shared/lib/translation/provider'
import { ChatMessage, ChatMessageTranslation, ChatUserSettings } from '../data/entities'
import { dbNow } from '../lib/clock'
import { loadChatMessages } from '../lib/messages'
import type { ChatScope } from '../lib/scope'
import { loadSpaceContext } from '../lib/spaces'
import {
  isTranslatable,
  normalizeText,
  prepareForTranslation,
  restoreAfterTranslation,
} from '../lib/translationText'
import {
  actingUserId,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
} from './shared'

export type TranslateMessagesInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  messageIds: string[]
  targetLocale: string
}

export type TranslatedMessage = {
  messageId: string
  /** Null when the message needed no translation, or none could be produced. */
  body: string | null
  sourceLocale: string | null
  /** Served from a previous translation rather than the engine. */
  cached: boolean
  /**
   * Why nothing came back, when nothing did. Distinguishing "already in your
   * language" from "the engine is down" is the difference between a sensible
   * message and a mystery.
   */
  skipped?: 'same-language' | 'nothing-to-translate' | 'unavailable' | 'failed'
}

/**
 * How long one Translate press may spend in the engine, in total.
 *
 * Sized against the reader, not the machine: past roughly half a minute the
 * control has read "Translating…" long enough that the answer has stopped being
 * useful, and the remaining messages are better reported as failed than waited
 * for. Whatever was translated before the deadline is kept and cached, so the
 * next press resumes rather than restarts.
 */
const TRANSLATION_BATCH_BUDGET_MS = 30_000

export type SetChatLocaleInput = {
  tenantId: string
  organizationId: string
  translationLocale: string | null
}

/**
 * Membership, then existence — in that order, and both against the same scope.
 *
 * `loadSpaceContext` throws `notFound` for a non-participant, so someone outside
 * the conversation cannot tell an existing message from an invented one.
 */
async function requireMessagesInConversation(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  messageIds: string[],
  userId: string,
): Promise<ChatMessage[]> {
  await loadSpaceContext(em, scope, conversationId, userId)
  const messages = await em.find(ChatMessage, {
    id: { $in: messageIds },
    conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    kind: 'user',
  })
  if (messages.length === 0) throw notFound((await loadChatMessages()).messageNotFound)
  return messages
}

const translateMessagesCommand: CommandHandler<
  TranslateMessagesInput,
  { translations: TranslatedMessage[] }
> = {
  id: 'chat.messages.translate',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const userId = await actingUserId(ctx)
    const em = forkEm(ctx)
    const target = input.targetLocale

    const messages = await requireMessagesInConversation(
      em, scope, input.conversationId, input.messageIds, userId,
    )

    // One query for the whole batch. The cache is shared across viewers, so a
    // conversation someone else already read in French costs nothing here.
    const cachedRows = await em.find(ChatMessageTranslation, {
      messageId: { $in: messages.map((m) => m.id) },
      targetLocale: target,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const cached = new Map(cachedRows.map((row) => [row.messageId, row]))

    const provider = getTranslationProvider()
    const results: TranslatedMessage[] = []

    // One timestamp for the batch. `dbNow` is a round trip, and a per-row call
    // inside the loop bought sub-second accuracy on a cache row nobody orders by.
    const now = await dbNow(em)

    /**
     * A ceiling on the whole batch, not just on each call.
     *
     * The per-request timeout bounds one engine call; sixty of them in series
     * bound nothing useful. Without an aggregate deadline a single request can
     * hold a connection, and the reader's "Translating…" control, for as long
     * as the batch size times that timeout.
     */
    const deadline = Date.now() + TRANSLATION_BATCH_BUDGET_MS
    const budget = new AbortController()

    for (const message of messages) {
      const hit = cached.get(message.id)
      if (hit) {
        // A row whose source is the target is the "already in your language"
        // answer, recorded so it is not re-asked. It must not be shown: the
        // reader would get their own words back labelled as a translation.
        results.push(
          hit.sourceLocale === target
            ? {
                messageId: message.id, body: null,
                sourceLocale: hit.sourceLocale, cached: true, skipped: 'same-language',
              }
            : {
                messageId: message.id, body: hit.body,
                sourceLocale: hit.sourceLocale ?? null, cached: true,
              },
        )
        continue
      }

      if (!isTranslatable(message.body)) {
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'nothing-to-translate',
        })
        continue
      }

      if (!provider || !provider.supports(undefined, target)) {
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'unavailable',
        })
        continue
      }

      if (Date.now() >= deadline) {
        budget.abort()
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'failed',
        })
        continue
      }

      // Mentions are lifted out before the engine sees them and put back after.
      // A translated `<@uuid>` no longer matches the mention pattern, so the
      // mention would silently stop being one.
      const prepared = prepareForTranslation(message.body)

      try {
        const translated = await provider.translate(
          { text: prepared.text, targetLocale: target },
          budget.signal,
        )

        const sameLanguage = translated.sourceLocale === target
        // The original stands as its own translation. Storing it costs a row
        // and saves an engine call per reader, per press, forever — and in a
        // conversation held mostly in the reader's language that is the
        // dominant case, so leaving it uncached made the cache useless exactly
        // where it mattered most.
        const body = sameLanguage
          ? normalizeText(message.body)
          : normalizeText(restoreAfterTranslation(translated.body, prepared.placeholders))

        const stored: TranslatedMessage = sameLanguage
          ? {
              messageId: message.id, body: null,
              sourceLocale: translated.sourceLocale, cached: false, skipped: 'same-language',
            }
          : {
              messageId: message.id, body,
              sourceLocale: translated.sourceLocale, cached: false,
            }

        em.persist(em.create(ChatMessageTranslation, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          messageId: message.id,
          // Carried so the composite foreign key can prove this row belongs to
          // the conversation it claims.
          conversationId: input.conversationId,
          targetLocale: target,
          body,
          sourceLocale: translated.sourceLocale,
          provider: translated.provider,
          modelRevision: translated.modelRevision ?? null,
          createdAt: now,
        }))

        try {
          await em.flush()
        } catch (error) {
          // Two people pressing Translate at the same moment race for the same
          // `(message_id, target_locale)`. The unique index decides; the loser
          // reads the winner's row rather than failing.
          if (!isUniqueViolation(error)) throw error
          em.clear()
          const winner = await em.findOne(ChatMessageTranslation, {
            messageId: message.id, targetLocale: target,
            tenantId: scope.tenantId, organizationId: scope.organizationId,
          })
          const winnerSource = winner?.sourceLocale ?? translated.sourceLocale
          results.push(
            winnerSource === target
              ? {
                  messageId: message.id, body: null,
                  sourceLocale: winnerSource, cached: true, skipped: 'same-language',
                }
              : {
                  messageId: message.id, body: winner?.body ?? body,
                  sourceLocale: winnerSource, cached: true,
                },
          )
          continue
        }

        results.push(stored)
      } catch {
        // One bad message must not fail the batch: the header control asks for a
        // whole page at once, and a single unsupported string should not leave
        // the rest untranslated.
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'failed',
        })
      }
    }

    return { translations: results }
  },
}

const setChatLocaleCommand: CommandHandler<SetChatLocaleInput, { translationLocale: string | null }> = {
  id: 'chat.settings.setLocale',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const userId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const existing = await em.findOne(ChatUserSettings, {
      userId, organizationId: input.organizationId, tenantId: input.tenantId,
    })

    if (existing) {
      existing.translationLocale = input.translationLocale
      await em.flush()
      return { translationLocale: existing.translationLocale ?? null }
    }

    const now = await dbNow(em)
    em.persist(em.create(ChatUserSettings, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId,
      translationLocale: input.translationLocale,
      createdAt: now,
      updatedAt: now,
    }))
    try {
      await em.flush()
    } catch (error) {
      // Same row from two tabs: the unique index decides, and the second write
      // becomes an update rather than an error.
      if (!isUniqueViolation(error)) throw error
      em.clear()
      const winner = await em.findOne(ChatUserSettings, {
        userId, organizationId: input.organizationId, tenantId: input.tenantId,
      })
      // The insert lost the race, so a row exists — unless it was removed or
      // belongs to another scope, in which case nothing was stored and saying
      // otherwise leaves the reader with a language the next page load forgets.
      if (!winner) throw notFound('Chat settings')
      winner.translationLocale = input.translationLocale
      await em.flush()
    }
    return { translationLocale: input.translationLocale }
  },
}

registerCommand(translateMessagesCommand)
registerCommand(setChatLocaleCommand)
