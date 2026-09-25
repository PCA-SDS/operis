'use client'

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Input } from '@open-mercato/ui/primitives/input'
import { InvoiceLineItems } from './components/InvoiceLineItems'
import { localDate } from '../../lib/localDates'
import { useInvoiceT as useT } from '../../lib/useInvoiceT'
import { invoiceManualWriteBaseSchema } from '../../data/validators'
import { useInvoiceCompanyLookup } from './useInvoiceCompanyLookup'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const invoiceFormDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'invoice.form.validation.date')
const invoicePaymentTermsSchema = z.coerce
  .number({ error: 'invoice.form.validation.number' })
  .int('invoice.form.validation.paymentTerms')
  .min(0, 'invoice.form.validation.paymentTerms')
  .max(3650, 'invoice.form.validation.paymentTerms')

function normalizeInvoicePercentInputs(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.lineItems)) return value
  return {
    ...record,
    lineItems: record.lineItems.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const line = item as Record<string, unknown>
      return {
        ...line,
        discountPercent: typeof line.discountPercent === 'string' && line.discountPercent.trim() === '' ? undefined : line.discountPercent,
        vatRate: typeof line.vatRate === 'string' && line.vatRate.trim() === '' ? undefined : line.vatRate,
      }
    }),
  }
}

const invoiceManualFormSchema = z.preprocess(
  normalizeInvoicePercentInputs,
  invoiceManualWriteBaseSchema
    .omit({ invoiceDate: true, dueDate: true })
    .extend({
      invoiceDate: invoiceFormDateSchema,
      paymentTerms: invoicePaymentTermsSchema.optional(),
      dueDate: z.union([invoiceFormDateSchema, z.literal(''), z.null()]).optional(),
    })
    .superRefine((input, ctx) => {
      if (input.partnerCountryCode === 'VN') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['partnerCountryCode'],
          message: 'invoice.form.validation.vnManualUnsupported',
        })
      }
    }),
).transform((input) => ({
  ...input,
  lineItems: input.lineItems.map((line) => ({
    ...line,
    discountPercent: line.discountPercent == null ? undefined : String(line.discountPercent),
    vatRate: line.vatRate == null ? undefined : String(line.vatRate),
  })),
}))

export type InvoiceFormValues = z.infer<typeof invoiceManualFormSchema> & { id?: string; updatedAt?: string }
type InvoiceFormLineItem = InvoiceFormValues['lineItems'][number]

function normalizeDecimal(value: string | number | null | undefined) {
  if (value == null) return value
  const trimmed = String(value).trim()
  if (!trimmed) return trimmed
  const [integerPart, fractionPart] = trimmed.split('.')
  if (!fractionPart) return `${integerPart}.00`
  const trimmedFraction = fractionPart.replace(/0+$/, '')
  const normalizedFraction = trimmedFraction.length <= 2 && fractionPart.length > 2
    ? trimmedFraction.padEnd(2, '0')
    : fractionPart.length < 2
      ? fractionPart.padEnd(2, '0')
      : trimmedFraction.length === 0
        ? '00'
        : trimmedFraction.length === 1
          ? `${trimmedFraction}0`
          : trimmedFraction
  return `${integerPart}.${normalizedFraction}`
}

function normalizeLineItems(lineItems: InvoiceFormValues['lineItems'] | undefined): InvoiceFormLineItem[] {
  return (lineItems ?? []).map((line) => ({
    name: line.name,
    unit: line.unit ?? null,
    quantity: normalizeDecimal(line.quantity) ?? '',
    unitPrice: normalizeDecimal(line.unitPrice) ?? '',
    discountAmount: line.discountPercent != null ? undefined : normalizeDecimal(line.discountAmount) ?? undefined,
    discountPercent: line.discountPercent != null ? String(line.discountPercent) : undefined,
    vatRate: line.vatRate != null ? String(line.vatRate) : undefined,
  }))
}

function isoDate(value: string | null) { return value ? localDate(value) : '' }

function dueDateForTerms(date: string, terms: number) {
  const result = new Date(`${date}T00:00:00`)
  result.setDate(result.getDate() + terms)
  return localDate(result)
}

function InvoicePartnerTaxCodeField({
  id,
  value,
  setValue,
  setFormValue,
  values,
  disabled,
  error,
  t,
  mode,
}: CrudCustomFieldRenderProps & { t: TranslateFn; mode: 'create' | 'edit' }) {
  const errorId = `${id}-error`
  const identifier = typeof value === 'string' ? value : ''
  const countryCode = typeof values?.partnerCountryCode === 'string' ? values.partnerCountryCode : ''
  const partnerName = typeof values?.partnerName === 'string' ? values.partnerName.trim() : ''
  const lookup = useInvoiceCompanyLookup(identifier, countryCode, mode === 'create')
  const appliedIdentifier = React.useRef<string | null>(null)

  React.useEffect(() => {
    const company = lookup.company
    const normalizedIdentifier = identifier.replace(/\s/g, '').toUpperCase()
    if (!company || !setFormValue || partnerName || appliedIdentifier.current === normalizedIdentifier) return
    if (company.registrationNumber !== normalizedIdentifier) return
    appliedIdentifier.current = normalizedIdentifier
    setFormValue('partnerName', company.name)
  }, [identifier, lookup.company, partnerName, setFormValue])

  const status = lookup.isLoading
    ? t('invoice.form.lookupChecking')
    : lookup.notFound
      ? t('invoice.form.lookupNotFound')
      : lookup.unavailable
        ? t('invoice.form.lookupUnavailable')
        : lookup.company
          ? t('invoice.form.lookupMatched', { name: lookup.company.name })
          : null

  return <div className="space-y-2">
    <Input
      aria-label={t('invoice.form.partnerTaxCode')}
      value={identifier}
      onChange={(event) => setValue(event.target.value)}
      disabled={disabled}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
    />
    {status ? <p className="text-sm text-muted-foreground" role="status">{status}</p> : null}
    {error ? <p id={errorId} className="text-xs font-medium text-status-error-text" role="alert">{error}</p> : null}
  </div>
}

export function InvoiceForm({ initialValues, mode, recordId, onSaved }: { initialValues?: Partial<InvoiceFormValues>; mode: 'create' | 'edit'; recordId?: string; onSaved: (id: string) => void }) {
  const t = useT()

  const schema = React.useMemo(() => invoiceManualFormSchema, [])
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'partnerName', type: 'text', label: t('invoice.form.partnerName'), required: true, layout: 'full' },
    { id: 'partnerTaxCode', type: 'custom', label: t('invoice.form.partnerTaxCode'), rendersOwnError: true, layout: 'half', component: (props) => <InvoicePartnerTaxCodeField {...props} t={t} mode={mode} /> },
    { id: 'partnerCountryCode', type: 'select', label: t('invoice.form.partnerCountry'), options: [{ value: 'US', label: t('invoice.form.country.US', 'United States') }, { value: 'SG', label: t('invoice.form.country.SG', 'Singapore') }, { value: 'TH', label: t('invoice.form.country.TH', 'Thailand') }, { value: 'MY', label: t('invoice.form.country.MY', 'Malaysia') }, { value: 'CN', label: t('invoice.form.country.CN', 'China') }, { value: 'JP', label: t('invoice.form.country.JP', 'Japan') }, { value: 'KR', label: t('invoice.form.country.KR', 'South Korea') }, { value: 'AU', label: t('invoice.form.country.AU', 'Australia') }, { value: 'GB', label: t('invoice.form.country.GB', 'United Kingdom') }, { value: 'DE', label: t('invoice.form.country.DE', 'Germany') }, { value: 'FR', label: t('invoice.form.country.FR', 'France') }], required: true, layout: 'half' },
    { id: 'invoiceSymbol', type: 'text', label: t('invoice.form.symbol'), layout: 'half' },
    { id: 'invoiceNumber', type: 'text', label: t('invoice.form.number'), required: true, layout: 'half' },
    { id: 'invoiceCode', type: 'text', label: t('invoice.form.code'), layout: 'half' },
    { id: 'invoiceDate', type: 'custom', label: t('invoice.form.invoiceDate'), required: true, layout: 'half', component: ({ value, setValue, setFormValue, values, error }) => <Input type="date" aria-label={t('invoice.form.invoiceDate')} required value={typeof value === 'string' ? value : ''} aria-invalid={Boolean(error)} onChange={(event) => { setValue(event.target.value); if (event.target.value && values?.paymentTerms != null) setFormValue?.('dueDate', dueDateForTerms(event.target.value, Number(values.paymentTerms))) }} /> },
    { id: 'paymentTerms', type: 'custom', label: t('invoice.form.paymentTerms'), layout: 'half', component: ({ value, setValue, setFormValue, values, error }) => <Input type="number" min="0" max="3650" step="1" aria-label={t('invoice.form.paymentTerms')} value={typeof value === 'number' || typeof value === 'string' ? value : ''} aria-invalid={Boolean(error)} onChange={(event) => { const terms = event.target.value ? Number(event.target.value) : undefined; setValue(terms); if (terms != null && typeof values?.invoiceDate === 'string' && values.invoiceDate) setFormValue?.('dueDate', dueDateForTerms(values.invoiceDate, terms)) }} /> },
    { id: 'dueDate', type: 'date', label: t('invoice.form.dueDate'), layout: 'half' },
    { id: 'currencyCode', type: 'select', label: t('invoice.form.currency'), options: ['VND', 'USD', 'EUR', 'SGD'].map((value) => ({ value, label: value })), required: true, layout: 'half' },
    { id: 'lineItems', type: 'custom', label: '', rendersOwnError: true, component: ({ value, setValue, error, errors, values }) => <InvoiceLineItems lines={Array.isArray(value) ? value as InvoiceFormValues['lineItems'] : []} onChange={setValue} currency={String(values?.currencyCode ?? 'VND')} error={error} errors={errors} /> },
  ], [mode, t])

  const groups = React.useMemo(() => [
    { id: 'supplier', title: t('invoice.form.groups.supplier'), description: t('invoice.form.groups.supplierDescription'), column: 1 as const, fields: ['partnerName', 'partnerTaxCode', 'partnerCountryCode'] },
    { id: 'details', title: t('invoice.form.groups.details'), column: 1 as const, fields: ['invoiceSymbol', 'invoiceNumber', 'invoiceDate', 'paymentTerms', 'dueDate', 'invoiceCode'] },
    { id: 'lines', title: t('invoice.form.groups.lines'), description: t('invoice.form.groups.linesDescription'), column: 1 as const, fields: ['currencyCode', 'lineItems'] },
  ], [t])

  const normalizedInitialValues = React.useMemo<Partial<InvoiceFormValues>>(() => ({
    currencyCode: 'VND',
    partnerCountryCode: 'SG',
    ...initialValues,
    lineItems: normalizeLineItems(initialValues?.lineItems ?? [{ name: '', unit: null, quantity: '1', unitPrice: '0', discountPercent: undefined, vatRate: undefined }]),
    paymentTerms: initialValues?.invoiceDate && initialValues?.dueDate ? Math.round((new Date(isoDate(initialValues.dueDate) + 'T00:00:00').getTime() - new Date(isoDate(initialValues.invoiceDate) + 'T00:00:00').getTime()) / 86400000) : undefined,
    invoiceDate: isoDate(initialValues?.invoiceDate ?? null),
    dueDate: isoDate(initialValues?.dueDate ?? null),
  }), [initialValues])

  return <CrudForm<InvoiceFormValues> title={t(mode === 'create' ? 'invoice.form.createTitle' : 'invoice.form.editTitle')} backHref="/backend/invoice/all" backLabel={t('invoice.form.backToInvoices')} fields={fields} groups={groups} schema={schema} disableNativeValidation initialValues={normalizedInitialValues} submitLabel={t('invoice.form.save')} cancelHref="/backend/invoice/all" onSubmit={async (values) => { const payload = { partnerName: values.partnerName, partnerTaxCode: values.partnerTaxCode?.trim() || null, partnerCountryCode: values.partnerCountryCode, invoiceSymbol: values.invoiceSymbol?.trim() || null, invoiceNumber: values.invoiceNumber, invoiceCode: values.invoiceCode?.trim() || null, invoiceDate: values.invoiceDate, dueDate: values.dueDate?.trim() || null, currencyCode: values.currencyCode, lineItems: values.lineItems.map((line) => ({ name: line.name, unit: line.unit?.trim() || null, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount?.trim() || undefined, discountPercent: line.discountPercent, vatRate: line.vatRate })) }; const targetId = recordId ?? values.id; const result = mode === 'create' ? await createCrud<{ invoice: { id: string } }>('invoice/invoices', payload) : targetId ? await updateCrud<{ invoice: { id: string } }>(`invoice/invoices/${targetId}`, payload) : (() => { throw createCrudFormError(t('invoice.errors.request_failed')) })(); const id = result.result?.invoice.id; if (!id) throw createCrudFormError(t('invoice.errors.request_failed')); flash(t('invoice.form.saved'), 'success'); onSaved(id) }} />
}
