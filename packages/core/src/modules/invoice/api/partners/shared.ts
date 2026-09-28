import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiResponseDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

import type { InvoiceCompany } from '../../data/entities'
import { invoiceCompanyIdSchema } from '../../data/validators'
import { toIsoOrNull as toIso } from '@open-mercato/shared/lib/date/normalize'
import {
  invoiceCommonErrors,
  invoicePartnersTag,
} from '../openapi'
import { toRecord } from '@open-mercato/shared/lib/guards'

const logger = createLogger('invoice').child({ component: 'partners-api' })

export const INVOICE_PARTNER_RESOURCE_KIND = 'invoice.company'
export const invoicePartnerRouteMetadata = {
  requireAuth: true,
  requireFeatures: ['invoice.settings.manage'],
} as const

export const invoicePartnerParamSchema = z.object({
  id: invoiceCompanyIdSchema,
})

export const invoicePartnerDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  taxCode: z.string(),
  countryCode: z.string(),
  defaultDueDays: z.number().int().nullable(),
  nameSourceDate: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const invoicePartnerListResponseSchema = z.object({
  items: z.array(invoicePartnerDtoSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
})

export const invoicePartnerMatchResponseSchema = z.object({
  partner: invoicePartnerDtoSchema.nullable(),
})

export const invoicePartnerUpdateResponseSchema = z.object({
  ok: z.literal(true),
  partner: invoicePartnerDtoSchema,
})

export const invoicePartnerRouteErrors: OpenApiResponseDoc[] = [...invoiceCommonErrors]
export { invoicePartnersTag }

export function toInvoicePartnerDto(company: InvoiceCompany): z.infer<typeof invoicePartnerDtoSchema> {
  return {
    id: company.id,
    name: company.name,
    taxCode: company.taxCode,
    countryCode: company.countryCode,
    defaultDueDays: company.defaultDueDays ?? null,
    nameSourceDate: toIso(company.nameSourceDate),
    updatedAt: toIso(company.updatedAt),
  }
}

export async function readRequestRecord(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export async function handleInvoicePartnerRouteError(err: unknown, label: string): Promise<NextResponse> {
  if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
  const { translate } = await resolveTranslations()
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('invoice.errors.invalid_input', 'Invalid input') }, { status: 400 })
  }
  logger.error('Invoice partner route failed', { label, err })
  return NextResponse.json({ error: translate('invoice.errors.request_failed', 'Failed to process invoice request') }, { status: 500 })
}
