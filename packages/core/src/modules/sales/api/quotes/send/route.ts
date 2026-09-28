import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations, detectLocale } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { EntityManager } from '@mikro-orm/postgresql'
import crypto from 'node:crypto'
import { withScopedPayload } from '../../utils'
import { hashAuthToken } from '../../../../auth/lib/tokenHash'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesQuote } from '../../../data/entities'
import { quoteSendSchema } from '../../../data/validators'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { resolveStatusEntryIdByValue } from '../../../lib/statusHelpers'
import { QuoteSentEmail } from '../../../emails/QuoteSentEmail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveGrantedFeatures } from '@open-mercato/shared/lib/auth/grantedFeatures'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveRequestContext } from '../requestContext'
import { emailSchema } from '@open-mercato/shared/lib/validation'

const logger = createLogger('sales')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.quotes.manage'] },
}

function resolveQuoteEmail(quote: SalesQuote): string | null {
  const snapshot = quote.customerSnapshot && typeof quote.customerSnapshot === 'object' ? (quote.customerSnapshot as Record<string, unknown>) : null
  const metadata = quote.metadata && typeof quote.metadata === 'object' ? (quote.metadata as Record<string, unknown>) : null
  const contact = snapshot?.contact as Record<string, unknown> | undefined
  const customer = snapshot?.customer as Record<string, unknown> | undefined
  const candidate =
    (typeof contact?.email === 'string' && contact.email.trim()) ||
    (typeof customer?.primaryEmail === 'string' && customer.primaryEmail.trim()) ||
    (typeof metadata?.customerEmail === 'string' && metadata.customerEmail.trim()) ||
    null
  if (!candidate) return null
  const parsed = emailSchema().safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await readJsonSafe(req, {})
    const scoped = withScopedPayload(payload ?? {}, ctx, translate)
    const input = quoteSendSchema.parse(scoped)
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: {
        userId: ctx.auth?.sub ?? '',
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId,
        userFeatures: await resolveGrantedFeatures(ctx.container, ctx.auth, organizationId),
      },
      input: { resourceKind: 'sales.quote', resourceId: input.quoteId, operation: 'update' },
    })
    if (!guardResult.ok) return guardResult.response

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tenantScope = ctx.auth?.tenantId ? { tenantId: ctx.auth.tenantId } : undefined
    const quote = await findOneWithDecryption(em, SalesQuote, { id: input.quoteId, deletedAt: null }, {}, tenantScope)
    if (!quote) {
      throw notFound(translate('sales.documents.detail.error', 'Document not found or inaccessible.'))
    }
    if (quote.tenantId !== ctx.auth?.tenantId || quote.organizationId !== ctx.selectedOrganizationId) {
      throw new CrudHttpError(403, { error: translate('sales.documents.errors.forbidden', 'Forbidden') })
    }

    if ((quote.status ?? null) === 'canceled') {
      throw new CrudHttpError(400, { error: translate('sales.quotes.send.canceled', 'Canceled quotes cannot be sent.') })
    }

    const email = resolveQuoteEmail(quote)
    if (!email) {
      throw new CrudHttpError(400, { error: translate('sales.quotes.send.missingEmail', 'Customer email is required to send a quote.') })
    }

    const now = new Date()
    const validUntil = new Date(now)
    validUntil.setUTCDate(validUntil.getUTCDate() + input.validForDays)

    const rawAcceptanceToken = crypto.randomUUID()

    // Persist the send state (status/token/sentAt) atomically and commit it
    // BEFORE the email goes out, so a customer never receives a link whose
    // acceptance token was not durably stored.
    await em.transactional(async (tx) => {
      quote.validUntil = validUntil
      quote.acceptanceToken = hashAuthToken(rawAcceptanceToken)
      quote.sentAt = now
      quote.status = 'sent'
      quote.statusEntryId = await resolveStatusEntryIdByValue(tx, {
        tenantId: quote.tenantId,
        organizationId: quote.organizationId,
        value: 'sent',
      })
      quote.updatedAt = now
      tx.persist(quote)
    })

    const appUrl = process.env.APP_URL || ''
    const url = appUrl ? `${appUrl.replace(/\/$/, '')}/quote/${rawAcceptanceToken}` : `/quote/${rawAcceptanceToken}`

    const locale = await detectLocale()
    const validUntilFormatted = validUntil.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const copy = {
      preview: translate('sales.quotes.email.preview', 'Quote {quoteNumber} is ready for review', { quoteNumber: quote.quoteNumber }),
      heading: translate('sales.quotes.email.heading', 'Quote {quoteNumber}', { quoteNumber: quote.quoteNumber }),
      total: translate('sales.quotes.email.total', 'Total: {amount} {currency}', {
        amount: quote.grandTotalGrossAmount ?? quote.grandTotalNetAmount ?? '0',
        currency: quote.currencyCode,
      }),
      validUntil: translate('sales.quotes.email.validUntil', 'Valid until: {date}', { date: validUntilFormatted }),
      cta: translate('sales.quotes.email.cta', 'View quote'),
      footer: translate('sales.quotes.email.footer', 'Open Mercato'),
    }

    // Side effect after commit: an email failure must not roll back the send state.
    await sendEmail({
      to: email,
      subject: translate('sales.quotes.email.subject', 'Quote {quoteNumber}', { quoteNumber: quote.quoteNumber }),
      react: QuoteSentEmail({ url, copy }),
    })

    await guardResult.runAfterSuccess()

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.quotes.send failed', { err })
    return NextResponse.json(
      { error: translate('sales.quotes.send.failed', 'Failed to send quote.') },
      { status: 400 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Send quote to customer',
  methods: {
    POST: {
      summary: 'Send quote',
      requestBody: {
        contentType: 'application/json',
        schema: quoteSendSchema,
      },
      responses: [
        { status: 200, description: 'Email queued', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Conflict detected', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 423, description: 'Record locked', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
