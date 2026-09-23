import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CustomerInteraction } from '../../../data/entities'
import { TERMINAL_INTERACTION_STATUS_LIST } from '../../../lib/interactionStatus'
import { canViewAllInteractions, resolveGrantedFeatures } from '../../../lib/visibilityFilter'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(1).max(1440),
  excludeId: z.string().uuid().optional(),
  // Comma-separated `interaction_type` allow-list. Omitted means every type,
  // which is the behaviour every existing caller already gets. Callers that
  // only care about one kind of clash (the calendar's meeting quick-add) pass
  // it so the narrowing happens in SQL — filtering the response client-side
  // would be wrong under the row limit below, which could fill with types the
  // caller discards and hide a real conflict behind them.
  types: z
    .string()
    .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(100)).min(1).max(20))
    .optional(),
  userId: z.string().uuid().optional(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-900).max(900).optional(),
})

const conflictItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  type: z.string(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    hasConflicts: z.boolean(),
    conflicts: z.array(conflictItemSchema),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interactions.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'Detect scheduling conflicts',
      description: 'Checks for overlapping planned interactions within the requested time window.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Conflict detection result',
          schema: responseSchema,
        },
      ],
    },
  },
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const queryUrl = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(queryUrl.searchParams))
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, {
        error: translate('customers.errors.unauthorized', 'Unauthorized'),
      })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationIds = Array.isArray(scope?.filterIds) && scope.filterIds.length > 0
      ? scope.filterIds
      : auth.orgId
        ? [auth.orgId]
        : []

    const offsetMinutes = query.timezoneOffsetMinutes ?? 0
    const offsetSign = offsetMinutes >= 0 ? '+' : '-'
    const absMinutes = Math.abs(offsetMinutes)
    const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, '0')
    const offsetMins = String(absMinutes % 60).padStart(2, '0')
    const offsetSuffix = `${offsetSign}${offsetHours}:${offsetMins}`
    const windowStart = new Date(`${query.date}T${query.startTime}:00${offsetSuffix}`)
    const windowEnd = new Date(windowStart.getTime() + query.duration * 60_000)

    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
      throw new CrudHttpError(400, { error: translate('customers.errors.invalid_date_time', 'Invalid date/time') })
    }

    const actorUserId = auth.isApiKey ? null : (auth.sub ?? auth.userId ?? null)
    const checkUserId = query.userId ?? auth.userId
    const em = (container.resolve('em') as EntityManager).fork()
    const kysely = em.getKysely<any>()

    let baseQuery = (kysely as any)
      .selectFrom('customer_interactions')
      .select(['id', 'scheduled_at', 'duration_minutes', 'interaction_type', 'author_user_id', 'owner_user_id', 'participants'])
      .where('tenant_id', '=', auth.tenantId)
      .where('status', 'not in', [...TERMINAL_INTERACTION_STATUS_LIST])
      .where('scheduled_at', 'is not', null)
      .where('deleted_at', 'is', null)

    if (organizationIds.length === 1) {
      baseQuery = baseQuery.where('organization_id', '=', organizationIds[0])
    } else if (organizationIds.length > 1) {
      baseQuery = baseQuery.where('organization_id', 'in', organizationIds)
    }

    if (checkUserId) {
      baseQuery = baseQuery.where((eb: any) =>
        eb.or([
          eb('author_user_id', '=', checkUserId),
          eb('owner_user_id', '=', checkUserId),
        ])
      )
    }

    if (query.excludeId) {
      baseQuery = baseQuery.where('id', '!=', query.excludeId)
    }

    if (query.types && query.types.length > 0) {
      baseQuery = baseQuery.where('interaction_type', 'in', query.types)
    }

    // Overlap condition: existing.start < windowEnd AND existing.end > windowStart
    // end = scheduled_at + duration_minutes (default 30 if null)
    baseQuery = baseQuery.where((eb: any) =>
      eb.and([
        eb('scheduled_at', '<', windowEnd.toISOString()),
        eb(sql`(scheduled_at + make_interval(mins => COALESCE(duration_minutes, 30)))`, '>', windowStart.toISOString()),
      ])
    )

    // Raw SELECT: reads only unencrypted columns (id, scheduled_at, duration_minutes, interaction_type); title is excluded to avoid ciphertext leakage and is resolved below via findWithDecryption.
    const rows = await baseQuery
      .orderBy('scheduled_at', 'asc')
      .limit(10)
      .execute() as Array<{
        id: string
        scheduled_at: string | Date
        duration_minutes: number | null
        interaction_type: string
        author_user_id: string | null
        owner_user_id: string | null
        participants: unknown
      }>

    /* Free/busy, not a peek at someone's day.
     *
     * `userId` lets a caller ask whether SOMEONE ELSE is free, which is what a
     * double-booking warning for an assignee needs. Knowing a colleague is busy
     * at 14:00 is the minimum that check can work on; knowing what they are
     * doing is not, and returning the subject line here would hand any holder of
     * `customers.interactions.view` a way to read every title on any colleague's
     * calendar one slot at a time — exactly what the personal scope on the list
     * endpoint exists to prevent.
     *
     * So the slot stays visible and the title is dropped unless the caller is
     * entitled to the row: author, owner, a listed participant, or a holder of
     * the oversight feature. The features lookup only runs when the caller is
     * asking about another user, so the common self-check (every keystroke in
     * the editor, debounced) costs no extra RBAC round-trip.
     */
    const askingAboutSelf = !actorUserId || checkUserId === actorUserId
    const callerCanViewAll = askingAboutSelf
      ? false
      : canViewAllInteractions(
          await resolveGrantedFeatures(container, actorUserId, auth.tenantId ?? null, auth.orgId ?? null),
        )
    const isEntitledToRow = (row: {
      author_user_id: string | null
      owner_user_id: string | null
      participants: unknown
    }): boolean => {
      if (askingAboutSelf || callerCanViewAll) return true
      if (!actorUserId) return false
      if (row.author_user_id === actorUserId || row.owner_user_id === actorUserId) return true
      return Array.isArray(row.participants)
        && row.participants.some((participant) => (
          typeof participant === 'object'
          && participant !== null
          && (participant as { userId?: unknown }).userId === actorUserId
        ))
    }

    const decryptionScope = {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    }
    const conflictIds = rows.filter(isEntitledToRow).map((row) => row.id)
    const interactionFilter: Record<string, unknown> = {
      id: { $in: conflictIds },
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    if (organizationIds.length === 1) {
      interactionFilter.organizationId = organizationIds[0]
    } else if (organizationIds.length > 1) {
      interactionFilter.organizationId = { $in: organizationIds }
    }
    const decryptedInteractions = conflictIds.length > 0
      ? await findWithDecryption(
          em,
          CustomerInteraction,
          interactionFilter as any,
          undefined,
          decryptionScope,
        )
      : []
    const titleById = new Map<string, string | null>()
    for (const record of decryptedInteractions) {
      titleById.set((record as any).id, ((record as any).title ?? null) as string | null)
    }

    const conflicts = rows.map((row) => {
      const start = new Date(row.scheduled_at)
      const durationMin = row.duration_minutes ?? 30
      const end = new Date(start.getTime() + durationMin * 60_000)
      // Unentitled rows were excluded from the decryption fetch above, so
      // they have no entry here and fall through to a titleless busy block.
      const title = titleById.get(row.id) ?? null
      return {
        id: row.id,
        title,
        startTime: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        endTime: end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        type: row.interaction_type,
      }
    })

    return NextResponse.json({
      ok: true,
      result: { hasConflicts: conflicts.length > 0, conflicts },
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('GET failed', { component: 'interactions/conflicts', err })
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}
