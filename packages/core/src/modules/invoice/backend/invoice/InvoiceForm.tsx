'use client'

import * as React from 'react'
import { z } from 'zod'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { invoiceDateStringSchema, invoiceManualWriteBaseSchema } from '../../data/validators'

const invoiceManualFormSchema = invoiceManualWriteBaseSchema
  .omit({ invoiceDate: true, dueDate: true })
  .extend({
    invoiceDate: invoiceDateStringSchema,
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

function isoDate(value: string | null) { return value ? value.slice(0, 10) : '' }

export function InvoiceForm({ initialValues, mode, onSaved }: { initialValues?: Partial<InvoiceFormValues>; mode: 'create' | 'edit'; onSaved: (id: string) => void }) {
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
    { id: 'invoiceDate', type: 'date', label: t('invoice.form.invoiceDate'), required: true, layout: 'half' },
    { id: 'dueDate', type: 'date', label: t('invoice.form.dueDate'), layout: 'half' },
    { id: 'currencyCode', type: 'select', label: t('invoice.form.currency'), options: ['VND', 'USD', 'EUR', 'SGD'].map((value) => ({ value, label: value })), required: true, layout: 'half' },
    { id: 'lineItems', type: 'custom', label: t('invoice.form.lines'), rendersOwnError: true, component: ({ value, setValue, error }) => {
      const lines = Array.isArray(value) ? value as InvoiceFormValues['lineItems'] : []
      return <div className="space-y-3"><div className="space-y-4">{lines.map((line, index) => <div className="space-y-2 border-b border-border pb-4 last:border-b-0" key={index}><div className="flex gap-2"><input className="min-w-0 flex-1 rounded-md border bg-input-bg px-3 py-2" aria-label={t('invoice.form.lineName')} placeholder={t('invoice.form.lineName')} value={line.name} onChange={(event) => setValue(lines.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><Button type="button" variant="outline" onClick={() => setValue(lines.filter((_, itemIndex) => itemIndex !== index))}>{t('invoice.form.removeLine')}</Button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><input className="rounded-md border bg-input-bg px-3 py-2" aria-label={t('invoice.form.quantity')} placeholder={t('invoice.form.quantity')} value={line.quantity} onChange={(event) => setValue(lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /><input className="rounded-md border bg-input-bg px-3 py-2" aria-label={t('invoice.form.unit')} placeholder={t('invoice.form.unit')} value={line.unit ?? ''} onChange={(event) => setValue(lines.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value || null } : item))} /><input className="rounded-md border bg-input-bg px-3 py-2" aria-label={t('invoice.form.unitPrice')} placeholder={t('invoice.form.unitPrice')} value={line.unitPrice} onChange={(event) => setValue(lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: event.target.value } : item))} /><input className="rounded-md border bg-input-bg px-3 py-2" aria-label={t('invoice.form.discount')} placeholder={t('invoice.form.discount')} value={line.discountPercent ?? ''} onChange={(event) => setValue(lines.map((item, itemIndex) => itemIndex === index ? { ...item, discountPercent: event.target.value || undefined } : item))} /><input className="rounded-md border bg-input-bg px-3 py-2" aria-label={t('invoice.form.vatRate')} placeholder={t('invoice.form.vatRate')} value={line.vatRate ?? ''} onChange={(event) => setValue(lines.map((item, itemIndex) => itemIndex === index ? { ...item, vatRate: event.target.value || undefined } : item))} /></div></div>)}</div>{error && <p className="text-sm text-destructive">{error}</p>}<Button type="button" variant="outline" onClick={() => setValue([...lines, { name: '', unit: null, quantity: '1', unitPrice: '0' }])}>{t('invoice.form.addLine')}</Button></div>
    } },
  ], [doLookup, lookupBusy, lookupMessage, t])

  const groups = React.useMemo(() => [
    { id: 'supplier', title: t('invoice.form.groups.supplier'), description: t('invoice.form.groups.supplierDescription'), column: 1 as const, fields: ['partnerName', 'partnerTaxCode', 'partnerCountryCode'] },
    { id: 'details', title: t('invoice.form.groups.details'), column: 1 as const, fields: ['invoiceSymbol', 'invoiceNumber', 'invoiceCode', 'invoiceDate', 'dueDate', 'currencyCode'] },
    { id: 'lines', title: t('invoice.form.groups.lines'), description: t('invoice.form.groups.linesDescription'), column: 1 as const, fields: ['lineItems'] },
  ], [t])

  return <CrudForm<InvoiceFormValues> title={t(mode === 'create' ? 'invoice.form.createTitle' : 'invoice.form.editTitle')} backHref="/backend/invoice/all" backLabel={t('invoice.form.backToInvoices')} fields={fields} groups={groups} schema={schema} initialValues={{ currencyCode: 'VND', lineItems: [], ...initialValues, invoiceDate: isoDate(initialValues?.invoiceDate ?? null), dueDate: isoDate(initialValues?.dueDate ?? null) }} submitLabel={t('invoice.form.save')} cancelHref="/backend/invoice/all" onSubmit={async (values) => { const result = mode === 'create' ? await createCrud<{ invoice: { id: string } }>('invoice/invoices', values) : await updateCrud<{ invoice: { id: string } }>(`invoice/invoices/${values.id}`, values); const id = result.result?.invoice.id; if (!id) throw createCrudFormError(t('invoice.errors.request_failed')); flash(t('invoice.form.saved'), 'success'); onSaved(id) }} />
}
