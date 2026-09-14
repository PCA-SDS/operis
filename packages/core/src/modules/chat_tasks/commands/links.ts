import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { forkEm } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError, badRequest, forbidden, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ChatMessage } from '@open-mercato/core/modules/chat/data/entities'
import { conversationAudience } from '@open-mercato/core/modules/chat/commands/shared'
import type { AppendChatCardInput, AppendChatCardResult } from '@open-mercato/core/modules/chat/commands/cards'
import type { RemoveChatCardInput, RemoveChatCardResult } from '@open-mercato/core/modules/chat/commands/cards'
import { ChatTaskLink, ChatTaskRequest } from '../data/entities'
import { emitChatTasksEvent, type ChatTasksEventId } from '../events'
import type { ChatTaskFields } from '../data/validators'
import { loadChatTasksMessages } from '../lib/messages'
import { callerHasFeatures, moduleEnabledForTenant, scopedWhere, type ChatTasksScope } from '../lib/scope'
import type { ChatTaskAssignmentService } from '../services/chatTaskAssignmentService'
import type { ChatTaskReadContext, ChatTaskService } from '../services/chatTaskService'

const logger = createLogger('chat_tasks')

/** The acting user, from the session, never from a payload. */
async function actingUserId(ctx: CommandRuntimeContext): Promise<string> {
  const subject = ctx.auth?.sub
  if (typeof subject === 'string' && subject.length > 0) return subject
  throw forbidden((await loadChatTasksMessages()).unauthorized)
}

function readContext(ctx: CommandRuntimeContext, scope: ChatTasksScope, userId: string, em: EntityManager): ChatTaskReadContext {
  return { container: ctx.container, em, scope, userId }
}

function chatTaskService(ctx: CommandRuntimeContext): ChatTaskService {
  return ctx.container.resolve('chatTaskService') as ChatTaskService
}

function assignmentService(ctx: CommandRuntimeContext): ChatTaskAssignmentService {
  return ctx.container.resolve('chatTaskAssignmentService') as ChatTaskAssignmentService
}

function commandBus(ctx: CommandRuntimeContext): CommandBus {
  return ctx.container.resolve('commandBus') as CommandBus
}

/**
 * Both halves must be switched on for this tenant.
 *
 * Entitlement is not ACL: an administrator can hold every task feature in a
 * tenant that does not have the tasks module. This integration must not be the
 * surface that quietly turns it back on.
 */
async function requireBothModules(ctx: CommandRuntimeContext, scope: ChatTasksScope): Promise<void> {
  const messages = await loadChatTasksMessages()
  const [chat, tasks] = await Promise.all([
    moduleEnabledForTenant(ctx.container, scope.tenantId, 'chat'),
    moduleEnabledForTenant(ctx.container, scope.tenantId, 'tasks'),
  ])
  if (!chat) throw badRequest(messages.chatModuleUnavailable)
  if (!tasks) throw badRequest(messages.tasksModuleUnavailable)
}

/**
 * A stable fingerprint of what was asked for.
 *
 * Key order is normalized and undefined is dropped, so two requests that mean the
 * same thing hash the same and a retry is recognised as one. Anything that would
 * change the resulting task is included; the idempotency key itself is not, or
 * every request would hash differently and the ledger would never match.
 */
/** A stable, explicit ordering for the id lists that go into the fingerprint. */
function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function hashRequest(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex')
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export type CreateChatTaskInput = ChatTaskFields & {
  tenantId: string
  organizationId: string
  /** Null for the personal workspace: no conversation, and therefore no card. */
  conversationId: string | null
  sourceMessageId?: string | null
  publishCard?: boolean
  idempotencyKey: string
}

export type CreateChatTaskResult = {
  taskId: string
  linkId: string | null
  cardMessageId: string | null
  cardPublished: boolean
  replayed: boolean
}

/**
 * Create a task from a conversation, link it, and post its card.
 *
 * Three writes that deliberately do NOT share one transaction:
 *
 * `tasks.tasks.create` takes a row lock on its project to mint `PROJ-n`, and it
 * announces the assignment when it is done. Composing it into an outer
 * transaction would hold that lock for the length of this whole operation and —
 * worse — would emit an assignment notification inside a transaction that can
 * still roll back, telling somebody they own a task that then ceases to exist.
 *
 * So the sequence is made safe to *repeat* instead of made atomic:
 *
 *   A. claim the idempotency key (own transaction, unique index)
 *   B. create the task (its own transaction, its own lock)
 *   C. record the link and complete the ledger (own transaction)
 *   D. publish the card, then record it
 *
 * A retry with the same key never reaches B twice: the claim in A either succeeds
 * once, or finds the existing row and answers from it. A crash between B and C
 * leaves the ledger `pending` and a real, visible task in the project — a retry is
 * refused with `request_in_progress` rather than creating a second one, and the
 * orphan is a task the user can see and link by hand. That is the honest failure:
 * no duplicate, nothing silently deleted, and nothing claimed to have failed that
 * actually succeeded.
 */
const createChatTaskCommand: CommandHandler<CreateChatTaskInput, CreateChatTaskResult> = {
  id: 'chat_tasks.links.createTask',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    await requireBothModules(ctx, { tenantId: input.tenantId, organizationId: input.organizationId })

    const messages = await loadChatTasksMessages()
    const scope: ChatTasksScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)
    const read = readContext(ctx, scope, actorUserId, em)
    const service = chatTaskService(ctx)

    // Creating a task needs the task grant, whatever the caller may do in chat.
    // This is the first half of "chat access never grants task access".
    const canCreate = await callerHasFeatures(ctx.container, actorUserId, scope, ['tasks.create'])
    if (!canCreate) throw forbidden(messages.cannotCreateTasks)

    // And reading the conversation needs membership, whatever the caller may do in
    // tasks. That is the second half, and it answers 404 so a non-member cannot
    // tell an existing conversation from one that never existed.
    if (input.conversationId) {
      await service.requireConversationAccess(read, input.conversationId)
    }

    /**
     * The source message must be in THIS conversation and still live.
     *
     * Checked here rather than trusted from the composer: a message id from
     * another conversation would otherwise be recorded as this task's origin and
     * later shown to everyone who can read this conversation.
     */
    if (input.sourceMessageId) {
      if (!input.conversationId) throw badRequest(messages.messageNotFound)
      const message = await em.findOne(
        ChatMessage,
        scopedWhere(scope, {
          id: input.sourceMessageId,
          conversationId: input.conversationId,
          deletedAt: null,
        }),
      )
      if (!message) throw notFound(messages.messageNotFound)
    }

    const assigneeIds = await assignmentService(ctx).resolveAssignees(read, {
      conversationId: input.conversationId,
      requestedAssigneeIds: input.assigneeIds,
      requestedRoleTargets: input.assignmentTargets?.length ?? 0,
    })

    const projectId = input.projectId ?? (await inboxProjectId(ctx, read))
    const requestHash = hashRequest({
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId ?? null,
      title: input.title,
      description: input.description ?? null,
      descriptionPlaintext: input.descriptionPlaintext ?? null,
      priority: input.priority ?? null,
      // Sorted so the order the client happened to send ids in cannot change the
      // fingerprint — two requests that name the same people are the same request.
      // An explicit comparator because the default one stringifies, which is a
      // different order than these uuids compare in.
      assigneeIds: [...assigneeIds].sort(compareIds),
      assignmentTargets: (input.assignmentTargets ?? []).map((target) => target.roleId).sort(compareIds),
      projectId,
      milestoneId: input.milestoneId ?? null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      recurrence: input.recurrence ?? null,
      labelIds: [...(input.labelIds ?? [])].sort(compareIds),
      publishCard: input.publishCard ?? true,
      // `tz` changes the task: with a recurrence and no due date the tasks module
      // derives the first occurrence from today *in this zone*, so two requests
      // that differ only in `tz` are two different tasks and must not share a
      // fingerprint.
      tz: input.tz ?? null,
    })

    // ---- Phase A: claim the key ------------------------------------------------
    const claim = await claimRequest(em, {
      scope,
      actorUserId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      conversationId: input.conversationId,
    })

    if (claim.kind === 'replay') {
      /**
       * Access is re-checked before a replay answers.
       *
       * The first attempt succeeded while the caller was still a member and still
       * held the grants. Replaying the stored result without asking again would
       * hand a task's details to somebody who has since been removed from the
       * conversation or had their task grant revoked.
       */
      if (input.conversationId) await service.requireConversationAccess(read, input.conversationId)
      await service.requireReadableTask(read, claim.taskId)
      /**
       * The card is read from the link, not remembered on the ledger.
       *
       * The ledger records which task and which link the first attempt produced;
       * whether a card was posted lives on the link, and can change after the
       * request completed (a card published on retry, or removed by an unlink).
       * Reporting a remembered `null` here told the caller "the card could not be
       * posted" for a create that had posted one, and sent them to a retry that
       * then failed with `card_already_published`.
       */
      const cardMessageId = claim.linkId
        ? ((
            await em.findOne(
              ChatTaskLink,
              scopedWhere(scope, { id: claim.linkId, deletedAt: null }),
            )
          )?.cardMessageId ?? null)
        : null
      return {
        taskId: claim.taskId,
        linkId: claim.linkId,
        cardMessageId,
        cardPublished: cardMessageId !== null,
        replayed: true,
      }
    }
    if (claim.kind === 'hash_mismatch') throw conflictWithCode(messages.idempotencyKeyReused, 'idempotency_key_reuse')
    if (claim.kind === 'in_progress') throw conflictWithCode(messages.requestInProgress, 'request_in_progress')

    // ---- Phase B: the task, through the tasks module's own command -------------
    let taskId: string
    try {
      const created = await commandBus(ctx).execute<Record<string, unknown>, { taskId: string }>(
        'tasks.tasks.create',
        {
          input: {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            projectId,
            title: input.title,
            description: input.description ?? null,
            descriptionPlaintext: input.descriptionPlaintext ?? null,
            // Work raised from a conversation is meant to be started, not filed:
            // the same choice Quick Add makes, for the same reason.
            status: 'pending',
            priority: input.priority ?? 'none',
            assigneeIds,
            assignmentTargets: input.assignmentTargets ?? [],
            milestoneId: input.milestoneId ?? null,
            dueDate: input.dueDate ?? null,
            // Passed through, never normalized away. Dropping a time because no
            // date came with it silently produced a different task from the one
            // the caller described — the tasks module refuses that combination
            // with `dueTimeNeedsDate`, and it owns the rule, so it gets to answer.
            dueTime: input.dueTime ?? null,
            recurrence: input.recurrence,
            labelIds: input.labelIds ?? [],
            tz: input.tz,
          },
          ctx,
        },
      )
      taskId = created.result.taskId
    } catch (error) {
      // The claim is released so the user can correct the input and try again with
      // a fresh key — and so a genuine retry of the SAME input is not answered
      // with "still in progress" forever.
      await markRequestFailed(forkEm(ctx), scope, actorUserId, input.idempotencyKey, error)
      throw error
    }

    // ---- Phase C: the link, and the ledger, together --------------------------
    let linkId: string | null = null
    if (input.conversationId) {
      linkId = await recordLink(forkEm(ctx), {
        scope,
        conversationId: input.conversationId,
        taskId,
        sourceMessageId: input.sourceMessageId ?? null,
        createdByUserId: actorUserId,
      })
    }
    await completeRequest(forkEm(ctx), scope, actorUserId, input.idempotencyKey, { taskId, linkId })

    // ---- Phase D: the card -----------------------------------------------------
    let cardMessageId: string | null = null
    if (linkId && input.conversationId && (input.publishCard ?? true)) {
      cardMessageId = await publishCard(ctx, {
        scope,
        conversationId: input.conversationId,
        linkId,
        actorUserId,
      })
    }

    // Announced once the link is durable, so a participant's panel and any card
    // already on screen refetch instead of waiting for a stale-time to expire.
    if (linkId && input.conversationId) {
      await emitLinkEvent(ctx, 'chat_tasks.link.created', {
        scope,
        conversationId: input.conversationId,
        linkId,
      })
    }

    return {
      taskId,
      linkId,
      cardMessageId,
      // Honest: `false` here with a real `taskId` is the partial success the
      // caller is told about and offered a retry for.
      cardPublished: cardMessageId !== null,
      replayed: false,
    }
  },
}

registerCommand(createChatTaskCommand)

export type LinkChatTaskInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  taskId: string
  sourceMessageId?: string | null
  publishCard?: boolean
}

export type LinkChatTaskResult = {
  linkId: string
  cardMessageId: string | null
  cardPublished: boolean
}

/**
 * Link a task that already exists.
 *
 * Both boundaries again, and in this order: the caller must be able to read the
 * conversation, AND to read the task. Linking a task somebody cannot read would
 * let them put it in front of colleagues who can, using nothing but its id.
 */
const linkChatTaskCommand: CommandHandler<LinkChatTaskInput, LinkChatTaskResult> = {
  id: 'chat_tasks.links.linkExisting',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    await requireBothModules(ctx, { tenantId: input.tenantId, organizationId: input.organizationId })

    const messages = await loadChatTasksMessages()
    const scope: ChatTasksScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)
    const read = readContext(ctx, scope, actorUserId, em)
    const service = chatTaskService(ctx)

    await service.requireConversationAccess(read, input.conversationId)
    await service.requireReadableTask(read, input.taskId)

    if (input.sourceMessageId) {
      const message = await em.findOne(
        ChatMessage,
        scopedWhere(scope, {
          id: input.sourceMessageId,
          conversationId: input.conversationId,
          deletedAt: null,
        }),
      )
      if (!message) throw notFound(messages.messageNotFound)
    }

    const linkId = await recordLink(forkEm(ctx), {
      scope,
      conversationId: input.conversationId,
      taskId: input.taskId,
      sourceMessageId: input.sourceMessageId ?? null,
      createdByUserId: actorUserId,
    })

    let cardMessageId: string | null = null
    if (input.publishCard ?? true) {
      const existing = await forkEm(ctx).findOne(ChatTaskLink, scopedWhere(scope, { id: linkId }))
      // Converging rather than refusing: linking a task that is already linked and
      // already carded is a no-op, and reporting it as a conflict would make a
      // double click look like a failure.
      cardMessageId =
        existing?.cardMessageId ??
        (await publishCard(ctx, { scope, conversationId: input.conversationId, linkId, actorUserId }))
    }

    await emitLinkEvent(ctx, 'chat_tasks.link.created', {
      scope,
      conversationId: input.conversationId,
      linkId,
    })

    return { linkId, cardMessageId, cardPublished: cardMessageId !== null }
  },
}

registerCommand(linkChatTaskCommand)

export type PublishChatTaskCardInput = {
  tenantId: string
  organizationId: string
  linkId: string
}

export type PublishChatTaskCardResult = { cardMessageId: string }

/**
 * Post the card for a link that has none.
 *
 * This is the recovery path for the case the create flow reports honestly: the
 * task exists, the card does not. It never creates a task, so retrying it cannot
 * duplicate work — and it refuses when a card is already there rather than posting
 * a second one.
 */
const publishChatTaskCardCommand: CommandHandler<PublishChatTaskCardInput, PublishChatTaskCardResult> = {
  id: 'chat_tasks.cards.publish',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    // Asked here too, not only on the create. A tenant whose `tasks` entitlement
    // was withdrawn must not still be able to post task cards into conversations
    // through the links it made while it had one.
    await requireBothModules(ctx, { tenantId: input.tenantId, organizationId: input.organizationId })

    const messages = await loadChatTasksMessages()
    const scope: ChatTasksScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)
    const read = readContext(ctx, scope, actorUserId, em)
    const service = chatTaskService(ctx)

    const link = await em.findOne(ChatTaskLink, scopedWhere(scope, { id: input.linkId, deletedAt: null }))
    if (!link) throw notFound(messages.linkNotFound)
    await service.requireConversationAccess(read, link.conversationId)
    if (link.cardMessageId) throw badRequest(messages.cardAlreadyPublished)

    const cardMessageId = await publishCard(ctx, {
      scope,
      conversationId: link.conversationId,
      linkId: link.id,
      actorUserId,
    })
    if (!cardMessageId) throw badRequest(messages.cardNotPublished)
    // A card appearing is a change to what this conversation's linked tasks look
    // like, so it is announced exactly like a new link.
    await emitLinkEvent(ctx, 'chat_tasks.link.created', {
      scope,
      conversationId: link.conversationId,
      linkId: link.id,
    })
    return { cardMessageId }
  },
}

registerCommand(publishChatTaskCardCommand)

export type UnlinkChatTaskInput = {
  tenantId: string
  organizationId: string
  linkId: string
  /** Whether to take the card out of the transcript as well. */
  removeCard: boolean
}

export type UnlinkChatTaskResult = { linkId: string; cardRemoved: boolean }

/**
 * Unlink a task from a conversation.
 *
 * Three separate acts, and this is only one of them: unlinking removes the
 * connection, removing the card takes a row out of the transcript, and deleting
 * the task is the tasks module's business. **Nothing here ever deletes a task**,
 * and no chat-side or task-side delete can cascade into this table either — there
 * is no foreign key for one to travel down.
 */
const unlinkChatTaskCommand: CommandHandler<UnlinkChatTaskInput, UnlinkChatTaskResult> = {
  id: 'chat_tasks.links.unlink',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    await requireBothModules(ctx, { tenantId: input.tenantId, organizationId: input.organizationId })

    const messages = await loadChatTasksMessages()
    const scope: ChatTasksScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)
    const read = readContext(ctx, scope, actorUserId, em)
    const service = chatTaskService(ctx)

    const link = await em.findOne(ChatTaskLink, scopedWhere(scope, { id: input.linkId, deletedAt: null }))
    if (!link) throw notFound(messages.linkNotFound)
    await service.requireConversationAccess(read, link.conversationId)

    let cardRemoved = false
    if (input.removeCard && link.cardMessageId) {
      // Through chat's own command, so the author-or-owner rule and the
      // conversation's denormalized columns are handled by the module that owns
      // them. A failure here leaves the link in place rather than half-unlinking.
      await commandBus(ctx).execute<RemoveChatCardInput, RemoveChatCardResult>('chat.messages.removeCard', {
        input: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          conversationId: link.conversationId,
          messageId: link.cardMessageId,
        },
        ctx,
      })
      cardRemoved = true
    }

    const writeEm = forkEm(ctx)
    const row = await writeEm.findOne(ChatTaskLink, scopedWhere(scope, { id: link.id }))
    if (row) {
      row.deletedAt = new Date()
      if (cardRemoved) row.cardMessageId = null
      await writeEm.flush()
    }
    await emitLinkEvent(ctx, 'chat_tasks.link.removed', {
      scope,
      conversationId: link.conversationId,
      linkId: link.id,
    })
    return { linkId: link.id, cardRemoved }
  },
}

registerCommand(unlinkChatTaskCommand)

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

type ClaimOutcome =
  | { kind: 'claimed' }
  | { kind: 'replay'; taskId: string; linkId: string | null }
  | { kind: 'hash_mismatch' }
  | { kind: 'in_progress' }

/** What `describeExisting` decides about a row that is already there. */
type ExistingOutcome = ClaimOutcome | { kind: 'reclaim' }

async function claimRequest(
  em: EntityManager,
  params: {
    scope: ChatTasksScope
    actorUserId: string
    idempotencyKey: string
    requestHash: string
    conversationId: string | null
  },
): Promise<ClaimOutcome> {
  const { scope, actorUserId, idempotencyKey, requestHash } = params

  const existing = await em.findOne(
    ChatTaskRequest,
    scopedWhere(scope, { actorUserId, idempotencyKey }),
  )
  if (existing) return reclaim(em, existing, requestHash)

  try {
    const row = em.create(ChatTaskRequest, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      actorUserId,
      idempotencyKey,
      requestHash,
      conversationId: params.conversationId,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(row)
    await em.flush()
    return { kind: 'claimed' }
  } catch (error) {
    // Two requests raced on the same key. The index picked a winner; read it.
    if (!isUniqueViolation(error)) throw error
    const winner = await em.fork().findOne(
      ChatTaskRequest,
      scopedWhere(scope, { actorUserId, idempotencyKey }),
    )
    if (!winner) throw error
    return reclaim(em, winner, requestHash)
  }
}

/**
 * Take over a row that is already there — and, for a failed one, re-arm it.
 *
 * Re-arming is the whole point. `failed` means the previous attempt got no
 * further than the task create, so repeating it is safe; but if the row were left
 * saying `failed` while this attempt ran, a crash between the task create and
 * `completeRequest` would leave it saying `failed` still, and the attempt after
 * that would be admitted too — and would create a SECOND task under a key whose
 * entire purpose is that it cannot. Flipping it back to `pending` here closes
 * that window: the next attempt reads `pending` and is refused as in-progress,
 * which is the same answer a first attempt's crash already produces.
 */
export async function reclaim(
  em: EntityManager,
  row: ChatTaskRequest,
  requestHash: string,
): Promise<ClaimOutcome> {
  const outcome = describeExisting(row, requestHash)
  if (outcome.kind !== 'reclaim') return outcome
  row.status = 'pending'
  row.failureReason = null
  row.updatedAt = new Date()
  await em.flush()
  return { kind: 'claimed' }
}

function describeExisting(row: ChatTaskRequest, requestHash: string): ExistingOutcome {
  // The hash check comes first, and for a reason: a mismatched key is a client
  // bug, and answering "already done" would hand back a task that is not the one
  // the caller described.
  if (row.requestHash !== requestHash) return { kind: 'hash_mismatch' }
  if (row.status === 'completed' && row.taskId) {
    return { kind: 'replay', taskId: row.taskId, linkId: row.linkId ?? null }
  }
  // `failed` is retryable with the same key: the previous attempt created nothing,
  // so repeating the request cannot duplicate anything — provided the row is
  // re-armed, which `reclaim` does.
  if (row.status === 'failed') return { kind: 'reclaim' }
  return { kind: 'in_progress' }
}

async function completeRequest(
  em: EntityManager,
  scope: ChatTasksScope,
  actorUserId: string,
  idempotencyKey: string,
  result: { taskId: string; linkId: string | null },
): Promise<void> {
  const row = await em.findOne(ChatTaskRequest, scopedWhere(scope, { actorUserId, idempotencyKey }))
  if (!row) return
  row.status = 'completed'
  row.taskId = result.taskId
  row.linkId = result.linkId
  await em.flush()
}

async function markRequestFailed(
  em: EntityManager,
  scope: ChatTasksScope,
  actorUserId: string,
  idempotencyKey: string,
  error: unknown,
): Promise<void> {
  try {
    const row = await em.findOne(ChatTaskRequest, scopedWhere(scope, { actorUserId, idempotencyKey }))
    if (!row) return
    row.status = 'failed'
    row.failureReason = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
    await em.flush()
  } catch (releaseError) {
    // Never mask the original failure with a bookkeeping one — the caller needs to
    // know why their task was refused, not why the ledger could not be updated.
    logger.error('Could not release a chat_tasks idempotency claim', { err: releaseError })
  }
}

/**
 * The link row, converging on the one that already exists.
 *
 * `chat_task_links_scope_uq` makes "one task, one conversation, one link" a
 * database fact, so a double click loses the race safely and both attempts return
 * the same link — rather than stacking two cards for one task in one room.
 */
async function recordLink(
  em: EntityManager,
  params: {
    scope: ChatTasksScope
    conversationId: string
    taskId: string
    sourceMessageId: string | null
    createdByUserId: string
  },
): Promise<string> {
  const existing = await em.findOne(
    ChatTaskLink,
    scopedWhere(params.scope, {
      conversationId: params.conversationId,
      taskId: params.taskId,
      deletedAt: null,
    }),
  )
  if (existing) return existing.id

  try {
    const row = em.create(ChatTaskLink, {
      tenantId: params.scope.tenantId,
      organizationId: params.scope.organizationId,
      conversationId: params.conversationId,
      taskId: params.taskId,
      sourceMessageId: params.sourceMessageId,
      createdByUserId: params.createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(row)
    await em.flush()
    return row.id
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const winner = await em.fork().findOne(
      ChatTaskLink,
      scopedWhere(params.scope, {
        conversationId: params.conversationId,
        taskId: params.taskId,
        deletedAt: null,
      }),
    )
    if (!winner) throw error
    return winner.id
  }
}

/**
 * Post the card, then record which row it is.
 *
 * A failure here is caught and reported as "no card", never as "no task": the task
 * is already committed and somebody may already have been notified that it is
 * theirs. Failing the whole call would tell the user a lie, and compensating by
 * deleting the task would destroy work that exists.
 *
 * Publishing requires `chat.send`, which the route has already gated — asked again
 * here because a command must not depend on which route reached it.
 */
async function publishCard(
  ctx: CommandRuntimeContext,
  params: { scope: ChatTasksScope; conversationId: string; linkId: string; actorUserId: string },
): Promise<string | null> {
  const canSend = await callerHasFeatures(ctx.container, params.actorUserId, params.scope, ['chat.send'])
  if (!canSend) {
    logger.info('Skipping a chat task card: the actor cannot post in this conversation', {
      linkId: params.linkId,
    })
    return null
  }

  try {
    const appended = await commandBus(ctx).execute<AppendChatCardInput, AppendChatCardResult>(
      'chat.messages.appendCard',
      {
        input: {
          tenantId: params.scope.tenantId,
          organizationId: params.scope.organizationId,
          conversationId: params.conversationId,
        },
        ctx,
      },
    )

    // Recorded immediately after the row exists. A crash between the two leaves a
    // card row nothing points at, which renders as "cannot be shown" rather than
    // as a card for the wrong task — and the link can be republished, because its
    // `card_message_id` is still null.
    const em = forkEm(ctx)
    const link = await em.findOne(ChatTaskLink, scopedWhere(params.scope, { id: params.linkId }))
    if (link) {
      link.cardMessageId = appended.result.messageId
      await em.flush()
    }
    return appended.result.messageId
  } catch (error) {
    logger.error('Could not publish a chat task card', { linkId: params.linkId, err: error })
    return null
  }
}

/**
 * Tell the conversation's participants that its linked tasks changed.
 *
 * Emitted after the write has committed, and addressed to the live participant
 * rows rather than broadcast: a link event names a conversation, and a
 * conversation id on an organization-wide feed says who is talking to whom. The
 * payload is a pointer — the link and the conversation, never the task — so every
 * recipient still refetches through the authorized route and sees only the task
 * they may read.
 *
 * A failure here is logged and swallowed. The write is already durable; turning a
 * missed refresh into a failed unlink would be the worse outcome, and every
 * client refetches on reconnect anyway.
 */
async function emitLinkEvent(
  ctx: CommandRuntimeContext,
  eventId: ChatTasksEventId,
  params: { scope: ChatTasksScope; conversationId: string; linkId: string },
): Promise<void> {
  try {
    const audience = await conversationAudience(forkEm(ctx), params.scope, params.conversationId)
    if (audience.length === 0) return
    await emitChatTasksEvent(
      eventId,
      {
        conversationId: params.conversationId,
        linkId: params.linkId,
        tenantId: params.scope.tenantId,
        organizationId: params.scope.organizationId,
        recipientUserIds: audience,
      },
      { tenantId: params.scope.tenantId, organizationId: params.scope.organizationId },
    )
  } catch (error) {
    logger.error('Could not announce a chat task link change', {
      eventId,
      linkId: params.linkId,
      err: error,
    })
  }
}

async function inboxProjectId(ctx: CommandRuntimeContext, read: ChatTaskReadContext): Promise<string> {
  const messages = await loadChatTasksMessages()
  try {
    const service = ctx.container.resolve('tasksProjectService') as {
      ensureInbox: (em: EntityManager, scope: ChatTasksScope) => Promise<{ id: string }>
    }
    const inbox = await service.ensureInbox(read.em, read.scope)
    return inbox.id
  } catch {
    throw badRequest(messages.inboxUnavailable)
  }
}

/**
 * A 409 that names its cause.
 *
 * Two very different conditions share the status — a key reused with new input,
 * and a key whose first attempt has not finished — and a client has to tell them
 * apart: one is "reload and try again", the other is "wait, then look at your task
 * list". `code` is what carries that, the way the optimistic-lock conflict body
 * carries its own.
 */
function conflictWithCode(message: string, code: string): CrudHttpError {
  return new CrudHttpError(409, { error: message, code })
}
