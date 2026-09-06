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
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  MAX_TRANSLATABLE_SEGMENTS,
  detectionSegment,
  introducesMention,
  normalizeText,
  reassembleBody,
  segmentBody,
  translatableSegmentIndexes,
} from '../lib/translationText'
import {
  TranslationOverloadedError,
  coalesce,
  pipelineRevision,
  sourceHash,
  translationGateDepth,
  withTranslationSlot,
} from '../lib/translationGate'
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
   * Why nothing came back, when nothing did.
   *
   * Every requested message gets one of these or a body — the reader is never
   * left with an item that simply vanished from the response. The distinctions
   * are the difference between a sensible message and a mystery: "already in
   * your language" is a non-event, "this deployment cannot translate into
   * Klingon" is a settings problem, and "the engine is down" is an outage.
   */
  skipped?:
    | 'same-language'
    | 'nothing-to-translate'
    | 'unsupported-language'
    | 'detection-declined'
    | 'unavailable'
    | 'overloaded'
    | 'deadline-exceeded'
    | 'mentions-unsafe'
    | 'failed'
}

const logger = createLogger('chat').child({ component: 'translation' })

/** Why an engine call failed, as far as the caller needs to know. */
function classifyEngineFailure(error: unknown): TranslatedMessage['skipped'] {
  if (error instanceof TranslationOverloadedError) return 'overloaded'
  const message = error instanceof Error ? error.message : ''
  if (/could not be identified with confidence/.test(message)) return 'detection-declined'
  if (/unsupported (?:source|target) language/.test(message)) return 'unsupported-language'
  if (error instanceof Error && error.name === 'AbortError') return 'deadline-exceeded'
  return 'failed'
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

    const provider = getTranslationProvider()
    const revision = provider ? pipelineRevision(provider.id, provider.revision ?? null) : null

    // Hash first: the lookup is keyed on the exact bytes a row was made from,
    // so a body that ever changes cannot serve stale words.
    const hashes = new Map(messages.map((m) => [m.id, sourceHash(normalizeText(m.body))]))

    // One query for the whole batch. The cache is shared across viewers, so a
    // conversation someone else already read in French costs nothing here.
    const cachedRows = await em.find(ChatMessageTranslation, {
      messageId: { $in: messages.map((m) => m.id) },
      targetLocale: target,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const cached = new Map(cachedRows.map((row) => [row.messageId, row]))

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
    const startedAt = Date.now()
    const budget = new AbortController()
    const counts: Record<string, number> = {}
    const tally = (outcome: string) => { counts[outcome] = (counts[outcome] ?? 0) + 1 }

    for (const message of messages) {
      const hash = hashes.get(message.id)!
      const hit = cached.get(message.id)
      // A row from a different pipeline, or made from different bytes, is not
      // an answer to this question. It is left in place and overwritten below
      // rather than deleted, so an upgrade refreshes lazily and only for the
      // messages someone actually reads again.
      const usable = hit && hit.sourceHash === hash && hit.pipelineRevision === revision
      if (usable) {
        tally('cached')
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

      const segments = segmentBody(message.body)
      const translatable = translatableSegmentIndexes(segments)
      if (translatable.length === 0) {
        tally('nothing-to-translate')
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'nothing-to-translate',
        })
        continue
      }

      if (!provider) {
        tally('unavailable')
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'unavailable',
        })
        continue
      }

      // A language the reader may legitimately choose but this deployment
      // cannot produce. Reported as its own outcome so the settings problem is
      // not dressed up as an outage.
      if (!provider.supports(undefined, target)) {
        tally('unsupported-language')
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'unsupported-language',
        })
        continue
      }

      // Each run of prose is its own inference, so a message that alternates
      // mention and prose many times is declined rather than billed for.
      if (translatable.length > MAX_TRANSLATABLE_SEGMENTS) {
        tally('mentions-unsafe')
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'mentions-unsafe',
        })
        continue
      }

      if (Date.now() >= deadline) {
        budget.abort()
        tally('deadline-exceeded')
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped: 'deadline-exceeded',
        })
        continue
      }

      try {
        // Two readers pressing at the same moment cost one inference, not two.
        // The unique index below makes the second WRITE converge; this is what
        // stops the engine doing the work twice in the first place.
        const produced = await coalesce(
          `${message.id}\u0000${target}\u0000${revision}\u0000${hash}`,
          async () => {
            // Detection is settled ONCE, on the whole message, and then
            // asserted for every run. Measured against the real detector, a
            // single run of real French scored 0.40 and was declined while the
            // full message was unambiguous — fragments are exactly where
            // fastText is weakest, and letting each decide for itself would
            // translate one sentence from two different languages.
            const lead = detectionSegment(segments)!
            const detected = provider.detect
              ? await withTranslationSlot(() => provider.detect!(lead, budget.signal))
              : null
            const sourceLocale = detected?.sourceLocale
            if (sourceLocale === target) {
              return { sameLanguage: true as const, sourceLocale, body: null }
            }
            if (detected && !detected.supported) {
              throw new Error(`[internal] unsupported source language ${detected.sourceLocale}`)
            }
            const translations = new Map<number, string>()
            let resolvedSource = sourceLocale ?? null
            for (const index of translatable) {
              if (Date.now() >= deadline) throw new DOMException('batch deadline', 'AbortError')
              const value = segments[index]!.value.trim()
              const piece = await withTranslationSlot(() =>
                provider.translate(
                  { text: value, targetLocale: target, sourceLocale: sourceLocale ?? undefined },
                  budget.signal,
                ),
              )
              resolvedSource = resolvedSource ?? piece.sourceLocale
              if (piece.sourceLocale === target && translations.size === 0 && translatable.length === 1) {
                return { sameLanguage: true as const, sourceLocale: piece.sourceLocale, body: null }
              }
              if (typeof piece.body !== 'string' || piece.body.trim() === '') {
                throw new Error('[internal] translation engine returned an empty segment')
              }
              // The model never sees a mention token, so emitting one would be
              // an invention — and a mention is a live relationship in the
              // renderer, not decoration.
              if (introducesMention(piece.body)) {
                throw new Error('[internal] translation introduced a mention')
              }
              translations.set(index, piece.body)
            }
            return {
              sameLanguage: false as const,
              sourceLocale: resolvedSource!,
              body: reassembleBody(segments, translations),
            }
          },
        )

        // The original stands as its own translation for the same-language
        // case: storing it costs a row and saves an engine call per reader,
        // per press, forever.
        const storedBody = produced.sameLanguage
          ? normalizeText(message.body)
          : produced.body!

        const outcome: TranslatedMessage = produced.sameLanguage
          ? {
              messageId: message.id, body: null,
              sourceLocale: produced.sourceLocale, cached: false, skipped: 'same-language',
            }
          : {
              messageId: message.id, body: storedBody,
              sourceLocale: produced.sourceLocale, cached: false,
            }

        // The message may have gone while the engine was working. Rechecking
        // costs one indexed read and is the difference between a cache row for
        // something still readable and one for something withdrawn.
        const stillLive = await em.findOne(ChatMessage, {
          id: message.id,
          conversationId: input.conversationId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        })
        if (!stillLive || sourceHash(normalizeText(stillLive.body)) !== hash) {
          tally('withdrawn')
          results.push({
            messageId: message.id, body: null, sourceLocale: null,
            cached: false, skipped: 'failed',
          })
          continue
        }

        if (hit) {
          // A stale row for the same key: overwrite rather than insert, so the
          // table holds one row per message and language however many
          // pipelines it outlives.
          hit.body = storedBody
          hit.sourceLocale = produced.sourceLocale
          hit.provider = provider.id
          hit.modelRevision = provider.revision ?? null
          hit.sourceHash = hash
          hit.pipelineRevision = revision!
          hit.createdAt = now
        } else {
          em.persist(em.create(ChatMessageTranslation, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            messageId: message.id,
            // Carried so the composite foreign key can prove this row belongs to
            // the conversation and the tenant it claims.
            conversationId: input.conversationId,
            targetLocale: target,
            body: storedBody,
            sourceLocale: produced.sourceLocale,
            provider: provider.id,
            modelRevision: provider.revision ?? null,
            sourceHash: hash,
            pipelineRevision: revision!,
            createdAt: now,
          }))
        }

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
          // No winner means the row is not visible in this scope, so nothing
          // was stored. Returning the value anyway would claim a cache entry
          // that does not exist and re-run the engine on every later press.
          if (!winner) {
            tally('failed')
            results.push({
              messageId: message.id, body: null, sourceLocale: null,
              cached: false, skipped: 'failed',
            })
            continue
          }
          tally('raced')
          results.push(
            winner.sourceLocale === target
              ? {
                  messageId: message.id, body: null,
                  sourceLocale: winner.sourceLocale, cached: true, skipped: 'same-language',
                }
              : {
                  messageId: message.id, body: winner.body,
                  sourceLocale: winner.sourceLocale ?? null, cached: true,
                },
          )
          continue
        }

        tally(produced.sameLanguage ? 'same-language' : 'translated')
        results.push(outcome)
      } catch (error) {
        // One bad message must not fail the batch: the header control asks for a
        // whole page at once, and a single unsupported string should not leave
        // the rest untranslated.
        const skipped = classifyEngineFailure(error)
        tally(skipped ?? 'failed')
        // Counts and a reason, never the message or the translation. Without
        // this, an engine that is down and a message the engine cannot handle
        // were the same silent outcome, and a deployment running with the
        // feature accidentally off looked exactly like one that worked.
        logger.warn('Translation did not produce a result', {
          reason: skipped,
          targetLocale: target,
          errorName: error instanceof Error ? error.name : 'unknown',
          ...translationGateDepth(),
        })
        results.push({
          messageId: message.id, body: null, sourceLocale: null,
          cached: false, skipped,
        })
      }
    }

    /**
     * What the batch cost and what came of it — never what it said.
     *
     * Deliberately counts and reasons only. No body, no translation, no message
     * or mention identifier reaches a log, and every label here is bounded:
     * `targetLocale` is one of a fixed allowlist and the outcome keys are the
     * union's own members, so nothing produces unbounded cardinality. Tenant
     * and user are absent for the same reason.
     *
     * `@open-mercato/telemetry` would be the better home for these as real
     * counters, but `packages/core` does not depend on it and `lint:check-graph`
     * enforces that edge — adding it is a dependency-graph change rather than a
     * detail of this feature.
     */
    logger.info('Translation batch complete', {
      targetLocale: target,
      requested: messages.length,
      durationMs: Date.now() - startedAt,
      pipelineRevision: revision,
      ...counts,
      ...translationGateDepth(),
    })

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
