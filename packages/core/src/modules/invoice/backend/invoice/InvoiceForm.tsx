'use client'

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Input } from '@open-mercato/ui/primitives/input'
import { InvoiceLineItems } from './components/InvoiceLineItems'
import { localDate } from '../../lib/localDates'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useInvoiceT as useT } from '@open-mercato/core/modules/invoice/lib/useInvoiceT'
import { invoiceDateStringSchema, invoiceManualWriteBaseSchema } from '../../data/validators'

const invoiceManualFormSchema = invoiceManualWriteBaseSchema
  .omit({ invoiceDate: true, dueDate: true })
  .extend({
    invoiceDate: invoiceDateStringSchema,
    paymentTerms: z.coerce.number().int().min(0).max(3650).optional(),
    dueDate: z.union([invoiceDateStringSchema, z.literal(''), z.null()]).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.partnerCountryCode === 'VN') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partnerCountryCode'],
        message: 'Vietnamese partners are not supported for manual invoices',
      })
    }
  })

export type InvoiceFormValues = z.infer<typeof invoiceManualFormSchema> & { id?: string; updatedAt?: string }
type Lookup = { company: { name: string; taxCode: string | null; countryCode: string; address: string | null } | null }
type InvoiceFormLineItem = InvoiceFormValues['lineItems'][number]

function normalizeLineItems(lineItems: InvoiceFormValues['lineItems'] | undefined): InvoiceFormLineItem[] {
  return (lineItems ?? []).map((line) => ({
    name: line.name,
    unit: line.unit ?? null,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountPercent != null ? undefined : line.discountAmount ?? undefined,
    discountPercent: line.discountPercent ?? undefined,
    vatRate: line.vatRate ?? undefined,
  }))
}

function isoDate(value: string | null) { return value ? localDate(value) : '' }

function dueDateForTerms(date: string, terms: number) {
  const result = new Date(`${date}T00:00:00`)
  result.setDate(result.getDate() + terms)
  return localDate(result)
}

export function InvoiceForm({ initialValues, mode, recordId, onSaved }: { initialValues?: Partial<InvoiceFormValues>; mode: 'create' | 'edit'; recordId?: string; onSaved: (id: string) => void }) {
  const t = useT()
  const [lookupBusy, setLookupBusy] = React.useState(false)
  const [lookupMessage, setLookupMessage] = React.useState<string | null>(null)

  async function doLookup(values: Record<string, unknown>, setFormValue?: (id: string, value: unknown) => void) {
    const identifier = typeof values.partnerTaxCode === 'string' ? values.partnerTaxCode.trim() : ''
    const country = typeof values.partnerCountryCode === 'string' ? values.partnerCountryCode : 'VN'
    if (!identifier || !setFormValue) return
    setLookupBusy(true); setLookupMessage(null)
    const call = await apiCall<Lookup>(`/api/invoice/company-lookup/${encodeURIComponent(identifier)}?country=${encodeURIComponent(country)}`)
    setLookupBusy(false)
    if (!call.ok || !call.result?.company) { setLookupMessage(t('invoice.form.lookupUnavailable')); return }
    setFormValue('partnerName', call.result.company.name)
    setFormValue('partnerTaxCode', call.result.company.taxCode ?? identifier)
    setLookupMessage(t('invoice.form.lookupApplied'))
  }

  const schema = React.useMemo(() => invoiceManualFormSchema, [])
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'partnerName', type: 'text', label: t('invoice.form.partnerName'), required: true, layout: 'full' },
    { id: 'partnerTaxCode', type: 'custom', label: t('invoice.form.partnerTaxCode'), rendersOwnError: true, layout: 'half', component: ({ value, setValue, setFormValue, values }) => <div className="space-y-2"><div className="flex gap-2"><input className="min-w-0 flex-1 rounded-md border bg-input-bg px-3 py-2" aria-label={t('invoice.form.partnerTaxCode')} value={typeof value === 'string' ? value : ''} onChange={(event) => setValue(event.target.value)} /><Button type="button" variant="outline" disabled={lookupBusy} onClick={() => void doLookup(values ?? {}, setFormValue)}>{lookupBusy ? t('invoice.form.lookupBusy') : t('invoice.form.lookup')}</Button></div>{lookupMessage && <p className="text-sm text-muted-foreground">{lookupMessage}</p>}</div> },
    { id: 'partnerCountryCode', type: 'select', label: t('invoice.form.partnerCountry'), options: [{ value: 'US', label: t('invoice.form.country.US', 'United States') }, { value: 'SG', label: t('invoice.form.country.SG', 'Singapore') }, { value: 'TH', label: t('invoice.form.country.TH', 'Thailand') }, { value: 'MY', label: t('invoice.form.country.MY', 'Malaysia') }, { value: 'CN', label: t('invoice.form.country.CN', 'China') }, { value: 'JP', label: t('invoice.form.country.JP', 'Japan') }, { value: 'KR', label: t('invoice.form.country.KR', 'South Korea') }, { value: 'AU', label: t('invoice.form.country.AU', 'Australia') }, { value: 'GB', label: t('invoice.form.country.GB', 'United Kingdom') }, { value: 'DE', label: t('invoice.form.country.DE', 'Germany') }, { value: 'FR', label: t('invoice.form.country.FR', 'France') }], required: true, layout: 'half' },
    { id: 'invoiceSymbol', type: 'text', label: t('invoice.form.symbol'), layout: 'half' },
    { id: 'invoiceNumber', type: 'text', label: t('invoice.form.number'), required: true, layout: 'half' },
    { id: 'invoiceCode', type: 'text', label: t('invoice.form.code'), layout: 'half' },
    { id: 'invoiceDate', type: 'custom', label: t('invoice.form.invoiceDate'), required: true, layout: 'half', component: ({ value, setValue, setFormValue, values }) => <Input type="date" aria-label={t('invoice.form.invoiceDate')} required value={typeof value === 'string' ? value : ''} onChange={(event) => { setValue(event.target.value); if (event.target.value && values?.paymentTerms != null) setFormValue?.('dueDate', dueDateForTerms(event.target.value, Number(values.paymentTerms))) }} /> },
    { id: 'paymentTerms', type: 'custom', label: t('invoice.form.paymentTerms'), layout: 'half', component: ({ value, setValue, setFormValue, values }) => <Input type="number" min="0" max="3650" step="1" aria-label={t('invoice.form.paymentTerms')} value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={(event) => { const terms = event.target.value ? Number(event.target.value) : undefined; setValue(terms); if (terms != null && typeof values?.invoiceDate === 'string' && values.invoiceDate) setFormValue?.('dueDate', dueDateForTerms(values.invoiceDate, terms)) }} /> },
    { id: 'dueDate', type: 'date', label: t('invoice.form.dueDate'), layout: 'half' },
    { id: 'currencyCode', type: 'select', label: t('invoice.form.currency'), options: ['VND', 'USD', 'EUR', 'SGD'].map((value) => ({ value, label: value })), required: true, layout: 'half' },
    { id: 'lineItems', type: 'custom', label: '', rendersOwnError: true, component: ({ value, setValue, error, values }) => <InvoiceLineItems lines={Array.isArray(value) ? value as InvoiceFormValues['lineItems'] : []} onChange={setValue} currency={String(values?.currencyCode ?? 'VND')} error={error} /> },
  ], [doLookup, lookupBusy, lookupMessage, t])

  const groups = React.useMemo(() => [
    { id: 'supplier', title: t('invoice.form.groups.supplier'), description: t('invoice.form.groups.supplierDescription'), column: 1 as const, fields: ['partnerName', 'partnerTaxCode', 'partnerCountryCode'] },
    { id: 'details', title: t('invoice.form.groups.details'), column: 1 as const, fields: ['invoiceSymbol', 'invoiceNumber', 'invoiceDate', 'paymentTerms', 'dueDate', 'invoiceCode'] },
    { id: 'lines', title: t('invoice.form.groups.lines'), description: t('invoice.form.groups.linesDescription'), column: 1 as const, fields: ['currencyCode', 'lineItems'] },
  ], [t])

  const normalizedInitialValues = React.useMemo<Partial<InvoiceFormValues>>(() => ({
    currencyCode: 'VND',
    partnerCountryCode: 'SG',
    ...initialValues,
    lineItems: normalizeLineItems(initialValues?.lineItems ?? [{ name: '', unit: null, quantity: '1', unitPrice: '0' }]),
    paymentTerms: initialValues?.invoiceDate && initialValues?.dueDate ? Math.round((new Date(isoDate(initialValues.dueDate) + 'T00:00:00').getTime() - new Date(isoDate(initialValues.invoiceDate) + 'T00:00:00').getTime()) / 86400000) : undefined,
    invoiceDate: isoDate(initialValues?.invoiceDate ?? null),
    dueDate: isoDate(initialValues?.dueDate ?? null),
  }), [initialValues])

  return <CrudForm<InvoiceFormValues> title={t(mode === 'create' ? 'invoice.form.createTitle' : 'invoice.form.editTitle')} backHref="/backend/invoice/all" backLabel={t('invoice.form.backToInvoices')} fields={fields} groups={groups} schema={schema} initialValues={normalizedInitialValues} submitLabel={t('invoice.form.save')} cancelHref="/backend/invoice/all" onSubmit={async (values) => { const payload = { partnerName: values.partnerName, partnerTaxCode: values.partnerTaxCode?.trim() || null, partnerCountryCode: values.partnerCountryCode, invoiceSymbol: values.invoiceSymbol?.trim() || null, invoiceNumber: values.invoiceNumber, invoiceCode: values.invoiceCode?.trim() || null, invoiceDate: values.invoiceDate, dueDate: values.dueDate?.trim() || null, currencyCode: values.currencyCode, lineItems: values.lineItems.map((line) => ({ name: line.name, unit: line.unit?.trim() || null, quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount?.trim() || undefined, discountPercent: line.discountPercent, vatRate: line.vatRate })) }; const targetId = recordId ?? values.id; const result = mode === 'create' ? await createCrud<{ invoice: { id: string } }>('invoice/invoices', payload) : targetId ? await updateCrud<{ invoice: { id: string } }>(`invoice/invoices/${targetId}`, payload) : (() => { throw createCrudFormError(t('invoice.errors.request_failed')) })(); const id = result.result?.invoice.id; if (!id) throw createCrudFormError(t('invoice.errors.request_failed')); flash(t('invoice.form.saved'), 'success'); onSaved(id) }} />
}
