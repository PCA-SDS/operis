'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useInvoiceT } from '../../../lib/useInvoiceT'
import { invoiceTotals, lineTotals } from '../../../lib/lineTotals'
import { formatInvoiceMoney } from '../../../lib/format'
import type { InvoiceFormValues } from '../InvoiceForm'

type Line = InvoiceFormValues['lineItems'][number]
type Rates = { stale: boolean; rates: Record<string, { vndPerUnit: number }> }
type LineField = 'name' | 'quantity' | 'unit' | 'unitPrice' | 'discountAmount' | 'discountPercent' | 'vatRate'
const numericInputClassName = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

function InlineFieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="text-xs font-medium text-status-error-text" role="alert">{message}</p> : null
}

function PercentageInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> & {
  value?: string
  onChange: (value: string) => void
}) {
  return <Input
    {...props}
    type="text"
    inputMode="decimal"
    value={value ?? ''}
    onChange={(event) => onChange(event.target.value)}
    onWheel={(event) => event.currentTarget.blur()}
  />
}

export function InvoiceLineItems({ lines, onChange, currency, error, errors }: {
  lines: Line[]
  onChange: (lines: Line[]) => void
  currency: string
  error?: string
  errors?: Record<string, string>
}) {
  const t = useInvoiceT()
  const [rates, setRates] = React.useState<Rates | null>(null)
  React.useEffect(() => {
    let active = true
    void apiCall<Rates>('/api/invoice/exchange-rates').then((result) => {
      if (active && result.ok && result.result) setRates(result.result)
    })
    return () => { active = false }
  }, [])
  const rate = rates?.rates[currency]?.vndPerUnit
  const format = (amount: number, code = currency) => formatInvoiceMoney(amount, code)
  const amount = (value: number) => <><span>{format(value)}</span>{currency !== 'VND' && rate && <span className="ml-1 text-xs font-normal text-muted-foreground">(≈ {format(value * rate, 'VND')})</span>}</>
  const update = (index: number, changes: Partial<Line>) => onChange(lines.map((line, itemIndex) => itemIndex === index ? { ...line, ...changes } : line))
  const fieldError = (index: number, field: LineField) => errors?.[`lineItems.${index}.${field}`]
  const totals = invoiceTotals(lines)

  return <div className="space-y-6">
    {currency !== 'VND' && <p className="text-right text-sm text-muted-foreground">{rate ? <>1 {currency} ≈ {format(rate, 'VND')}{rates?.stale && <> · {t('invoice.dashboard.staleRates')}</>}</> : t('invoice.errors.exchange_rates_unavailable')}</p>}
    {lines.map((line, index) => {
      const percent = line.discountPercent !== undefined && line.discountPercent !== null
      const nameError = fieldError(index, 'name')
      const quantityError = fieldError(index, 'quantity')
      const unitError = fieldError(index, 'unit')
      const unitPriceError = fieldError(index, 'unitPrice')
      const discountField = percent ? 'discountPercent' : 'discountAmount'
      const discountError = fieldError(index, discountField)
      const vatError = fieldError(index, 'vatRate')
      return <div key={index} className="space-y-3 border-b border-border pb-5">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">{t('invoice.form.item', { number: index + 1 })} <span className="text-destructive">*</span></span>
            <Input required value={line.name} placeholder={t('invoice.form.lineName')} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `line-${index}-name-error` : undefined} onChange={(event) => update(index, { name: event.target.value })} />
            <InlineFieldError id={`line-${index}-name-error`} message={nameError} />
          </label>
          <IconButton type="button" variant="ghost" aria-label={t('invoice.form.removeItem', { number: index + 1 })} onClick={() => onChange(lines.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></IconButton>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="min-w-0 space-y-2"><span className="text-xs font-semibold uppercase text-muted-foreground">{t('invoice.form.quantity')} *</span><Input type="number" min="0.0001" step="0.0001" required value={line.quantity} aria-invalid={Boolean(quantityError)} aria-describedby={quantityError ? `line-${index}-quantity-error` : undefined} onChange={(event) => update(index, { quantity: event.target.value })} onWheel={(event) => event.currentTarget.blur()} inputClassName={numericInputClassName} /><InlineFieldError id={`line-${index}-quantity-error`} message={quantityError} /></label>
          <label className="min-w-0 space-y-2"><span className="text-xs font-semibold uppercase text-muted-foreground">{t('invoice.form.unit')}</span><Input value={line.unit ?? ''} placeholder={t('invoice.form.unitPlaceholder')} aria-invalid={Boolean(unitError)} aria-describedby={unitError ? `line-${index}-unit-error` : undefined} onChange={(event) => update(index, { unit: event.target.value || null })} /><InlineFieldError id={`line-${index}-unit-error`} message={unitError} /></label>
          <label className="min-w-0 space-y-2"><span className="text-xs font-semibold uppercase text-muted-foreground">{t('invoice.form.unitPrice')} *</span><Input type="number" min="0.0001" step="0.0001" required value={line.unitPrice} aria-invalid={Boolean(unitPriceError)} aria-describedby={unitPriceError ? `line-${index}-unit-price-error` : undefined} onChange={(event) => update(index, { unitPrice: event.target.value })} onWheel={(event) => event.currentTarget.blur()} inputClassName={numericInputClassName} /><InlineFieldError id={`line-${index}-unit-price-error`} message={unitPriceError} /></label>
          <div className="min-w-0 space-y-2">
            <label className="block text-xs font-semibold uppercase text-muted-foreground" htmlFor={`discount-${index}`}>{t('invoice.form.discount')}</label>
            <div className={`flex items-center rounded-md border bg-input-bg ${discountError ? 'border-destructive' : 'border-border'}`} role="group" aria-label={t('invoice.form.discountMode', 'Discount calculation mode')}>
              {percent ? <PercentageInput id={`discount-${index}`} min="0" max="100" step="0.0001" value={line.discountPercent ?? undefined} onChange={(value) => update(index, { discountPercent: value, discountAmount: undefined })} className="min-w-0 flex-1 rounded-r-none border-0 bg-transparent focus-visible:ring-0" aria-invalid={Boolean(discountError)} aria-describedby={discountError ? `line-${index}-discount-error` : undefined} /> : <Input id={`discount-${index}`} type="number" min="0" step="0.0001" value={line.discountAmount ?? ''} onChange={(event) => update(index, { discountAmount: event.target.value || undefined, discountPercent: undefined })} onWheel={(event) => event.currentTarget.blur()} inputClassName={numericInputClassName} className="min-w-0 flex-1 rounded-r-none border-0 bg-transparent focus-visible:ring-0" aria-invalid={Boolean(discountError)} aria-describedby={discountError ? `line-${index}-discount-error` : undefined} />}
              <Button type="button" size="sm" variant="ghost" className={`h-7 min-w-8 rounded-md px-2 text-xs font-semibold ${!percent ? 'bg-modal-muted text-foreground' : 'text-muted-foreground'}`} aria-pressed={!percent} aria-label={t('invoice.form.discountAmount')} onClick={() => {
                const base = Number(line.quantity || 0) * Number(line.unitPrice || 0)
                const amount = percent && base > 0 ? base * Number(line.discountPercent ?? 0) / 100 : Number(line.discountAmount ?? 0)
                update(index, { discountAmount: Number.isFinite(amount) ? String(amount) : undefined, discountPercent: undefined })
              }}>{currency || 'VND'}</Button>
              <Button type="button" size="sm" variant="ghost" className={`h-7 rounded-md px-1.5 text-xs font-semibold ${percent ? 'bg-modal-muted text-foreground' : 'text-muted-foreground'}`} aria-pressed={percent} aria-label={t('invoice.form.discountPercent')} onClick={() => {
                const base = Number(line.quantity || 0) * Number(line.unitPrice || 0)
                const percentage = !percent && base > 0 ? Number(line.discountAmount ?? 0) / base * 100 : Number(line.discountPercent ?? 0)
                update(index, { discountPercent: Number.isFinite(percentage) ? String(percentage) : undefined, discountAmount: undefined })
              }}>%</Button>
            </div>
            <InlineFieldError id={`line-${index}-discount-error`} message={discountError} />
          </div>
          <label className="min-w-0 space-y-2"><span className="text-xs font-semibold uppercase text-muted-foreground">{t('invoice.form.vatRate')}</span><PercentageInput min="0" max="100" step="0.0001" value={line.vatRate ?? undefined} onChange={(value) => update(index, { vatRate: value })} aria-invalid={Boolean(vatError)} aria-describedby={vatError ? `line-${index}-vat-error` : undefined} /><InlineFieldError id={`line-${index}-vat-error`} message={vatError} /></label>
          <div className="min-w-0 space-y-2 sm:text-right"><p className="text-xs font-semibold uppercase text-muted-foreground">{t('invoice.form.lineTotal')}</p><p className="pt-2 text-sm font-medium">{amount(lineTotals(line).total)}</p></div>
        </div>
      </div>
    })}
    {error && <p className="text-xs font-medium text-status-error-text" role="alert">{error}</p>}
    <Button type="button" variant="ghost" disabled={lines.length >= 100} onClick={() => onChange([...lines, { name: '', unit: null, quantity: '1', unitPrice: '0', discountPercent: undefined, vatRate: undefined }])}><Plus className="size-4" />{t('invoice.form.addLine')}</Button>
    <div className="space-y-2 border-t border-border pt-4">
      {(['subtotal', 'vat', 'total'] as const).map((key) => <div key={key} className={`flex flex-wrap justify-between gap-2 ${key === 'total' ? 'font-semibold' : 'text-sm'}`}><span>{t(`invoice.form.${key}`)}</span><p>{amount(totals[key])}</p></div>)}
    </div>
  </div>
}
