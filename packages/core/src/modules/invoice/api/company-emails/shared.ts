import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

import type { InvoiceCompanyEmail } from '../../data/entities'
import { invoiceCompanyEmailIdSchema } from '../../data/validators'
import { invoiceCommonErrors } from '../openapi'
import { toIsoOrNull } from '@open-mercato/shared/lib/date/normalize'
import { toRecord } from '@open-mercato/shared/lib/guards'

const logger = createLogger('invoice').child({ component: 'company-emails-api' })

export const INVOICE_COMPANY_EMAIL_RESOURCE_KIND = 'invoice.company_email'
export const invoiceCompanyEmailsTag = 'Invoice Company Emails'
export const invoiceCompanyEmailRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.manage'],
} as const

export const invoiceCompanyEmailParamSchema = z.object({
  id: invoiceCompanyEmailIdSchema,
})

export const invoiceCompanyEmailDtoSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  email: z.string(),
  updatedAt: z.string().nullable(),
})

export const invoiceCompanyEmailListResponseSchema = z.object({
  items: z.array(invoiceCompanyEmailDtoSchema),
})

export const invoiceCompanyEmailRecordResponseSchema = z.object({
  ok: z.literal(true),
  email: invoiceCompanyEmailDtoSchema.nullable(),
})

export const invoiceCompanyEmailDeleteResponseSchema = z.object({
  ok: z.literal(true),
})

export const invoiceCompanyEmailRouteErrors: OpenApiResponseDoc[] = [...invoiceCommonErrors]

export function toInvoiceCompanyEmailDto(
  email: InvoiceCompanyEmail,
): z.infer<typeof invoiceCompanyEmailDtoSchema> {
  return {
    id: email.id,
    companyId: email.company.id,
    email: email.email,
    updatedAt: toIsoOrNull(email.updatedAt),
  }
}

export async function readRequestRecord(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export async function handleInvoiceCompanyEmailRouteError(
  err: unknown,
  label: string,
): Promise<NextResponse> {
  if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
  const { translate } = await resolveTranslations()
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
  }
  logger.error('Invoice company email route failed', { label, err })
  return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
}
