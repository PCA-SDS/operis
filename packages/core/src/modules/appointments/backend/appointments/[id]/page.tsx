"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AppointmentStatusBadge } from '../../../components/AppointmentStatusBadge'
import { APPOINTMENT_BOOKING_TYPE_OPTIONS } from '../../../data/constants'
import { formatCustomerPhone } from '../../../lib/phoneSnapshot'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { CalendarDays, Check, ClipboardList, Clock3, Copy, DollarSign, FileText, Globe2, ListChecks, Mail, MapPin, Megaphone, MessageSquare, Phone, UserRound } from 'lucide-react'

type Line = {
  id: string
  productTitle: string
  productCategory: string | null
  durationMinutes: number | null
  unitPriceGross: string | null
  currencyCode: string | null
  options: Array<{
    groupName: string | null
    name: string
    priceFlat: string | null
  }>
}

type Detail = {
  id: string
  organizationId: string
  organizationName: string | null
  customerName: string
  customerSalutation: string | null
  customerPhone: string | null
  customerEmail: string | null
  customerPhoneCountryCode: string | null
  customerOrigin: string | null
  bookingType: string | null
  customerSource: string | null
  statusCode: string
  requestedStartAt: string
  requestedEndAt: string | null
  notes: string | null
  externalNotes: string | null
  lines: Line[]
  updatedAt: string
}

type StatusOption = {
  code: string
  label: string
  backgroundColor?: string | null
  textColor?: string | null
}

function formatDateTime(value: string | null, emptyLabel: string) {
  if (!value) return emptyLabel
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return emptyLabel
    return date.toLocaleString()
  } catch {
    return emptyLabel
  }
}

function formatCustomerName(salutation: string | null, name: string): string {
  const prefix = salutation?.trim()
  if (!prefix) return name
  return `${/[.!?]$/.test(prefix) ? prefix : `${prefix}.`} ${name}`.trim()
}

function formatBookingType(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  return APPOINTMENT_BOOKING_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function numericValue(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function Field({
  label,
  value,
  icon,
  layout = 'compact',
}: {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
  layout?: 'compact' | 'row'
}) {
  const isRow = layout === 'row'
  return (
    <div className={isRow ? 'flex items-start gap-3 py-3 first:pt-0 last:pb-0' : 'space-y-1'}>
      {isRow ? (
        <span className="mt-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <div className={isRow ? 'min-w-0 flex-1 space-y-1' : undefined}>
        <div className={isRow ? 'text-sm text-muted-foreground' : 'flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground'}>
          {!isRow ? icon : null}
          <span>{label}</span>
        </div>
        <div className={isRow ? 'text-base font-medium text-foreground' : 'text-sm text-foreground'}>{value}</div>
      </div>
    </div>
  )
}

function CopyField({
  label,
  value,
  emptyLabel,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
  icon,
  layout = 'compact',
}: {
  label: string
  value: string
  emptyLabel: string
  copyLabel: string
  copiedLabel: string
  copyFailedLabel: string
  icon?: React.ReactNode
  layout?: 'compact' | 'row'
}) {
  const [copied, setCopied] = React.useState(false)
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const handleCopy = async () => {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      flash(copyFailedLabel, 'error')
    }
  }

  const isRow = layout === 'row'

  return (
    <div className={isRow ? 'flex items-start gap-3 py-3 first:pt-0 last:pb-0' : 'space-y-1'}>
      {isRow ? (
        <span className="mt-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <div className={isRow ? 'min-w-0 flex-1 space-y-1' : undefined}>
        <div className={isRow ? 'text-sm text-muted-foreground' : 'flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground'}>
          {!isRow ? icon : null}
          <span>{label}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <div className={isRow ? 'min-w-0 flex-1 truncate text-base font-medium text-foreground' : 'min-w-0 flex-1 truncate text-sm text-foreground'}>{value || emptyLabel}</div>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            aria-label={copied ? copiedLabel : copyLabel}
            title={copied ? copiedLabel : copyLabel}
            disabled={!value}
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="size-4 text-status-success-text" /> : <Copy className="size-4" />}
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export default function AppointmentDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [detail, setDetail] = React.useState<Detail | null>(null)
  const [statuses, setStatuses] = React.useState<StatusOption[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      if (!id) return
      setIsLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const [detailCall, statusCall] = await Promise.all([
          apiCall<Detail>(`/api/appointments/${encodeURIComponent(id)}`, { signal: controller.signal }, { fallback: null }),
          apiCall<{ items?: StatusOption[] }>('/api/appointments/statuses', { signal: controller.signal }, {
            fallback: { items: [] },
          }),
        ])
        if (cancelled) return
        if (statusCall.ok) {
          setStatuses(statusCall.result?.items ?? [])
        }
        if (detailCall.ok && detailCall.result?.id) {
          setDetail(detailCall.result)
        } else if (detailCall.status === 404) {
          setNotFound(true)
        } else {
          setError(t('appointments.detail.error.loadFailed'))
        }
      } catch (err) {
        if (!cancelled) {
          setError(t('appointments.detail.error.loadFailed'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('common.loading')} />
        </PageBody>
      </Page>
    )
  }
  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('appointments.detail.notFound')}
            backHref="/backend/appointments"
            backLabel={t('appointments.list.title')}
          />
        </PageBody>
      </Page>
    )
  }
  if (error || !detail) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('appointments.detail.error.loadFailed')} />
        </PageBody>
      </Page>
    )
  }

  const empty = t('appointments.list.noValue')
  const phoneValue = formatCustomerPhone(detail.customerPhoneCountryCode, detail.customerPhone)
  const customerDisplayName = formatCustomerName(detail.customerSalutation, detail.customerName)
  const savedStatusLabel =
    statuses.find((status) => status.code === detail.statusCode)?.label ?? detail.statusCode
  const savedStatus = statuses.find((status) => status.code === detail.statusCode)
  const totalAmount = detail.lines.reduce((total, line) => {
    const basePrice = numericValue(line.unitPriceGross) ?? 0
    const optionTotal = line.options.reduce((sum, option) => sum + (numericValue(option.priceFlat) ?? 0), 0)
    return total + basePrice + optionTotal
  }, 0)
  const totalCurrencyCode = detail.lines.find((line) => line.currencyCode)?.currencyCode ?? null

  return (
    <Page>
      <PageBody className="space-y-4">
        <FormHeader
          mode="detail"
          backHref="/backend/appointments"
          backLabel={t('appointments.list.title')}
          title={(
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{customerDisplayName}</span>
              <AppointmentStatusBadge
                statusCode={detail.statusCode}
                label={savedStatusLabel}
                backgroundColor={savedStatus?.backgroundColor}
                textColor={savedStatus?.textColor}
              />
              {detail.organizationName ? (
                <span className="text-sm font-medium text-muted-foreground">
                  {detail.organizationName}
                </span>
              ) : null}
            </span>
          )}
        />

        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">
            {t('appointments.detail.group.customer')}
          </h2>
          <div className="divide-y divide-border">
            <Field
              label={t('appointments.detail.field.name')}
              value={(
                <span className="flex flex-wrap items-center gap-2">
                  {detail.customerSalutation ? (
                    <span className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-sm font-medium text-foreground">
                      {detail.customerSalutation}
                    </span>
                  ) : null}
                  <span>{detail.customerName}</span>
                </span>
              )}
              icon={<UserRound className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <CopyField
              label={t('appointments.detail.field.phone')}
              value={phoneValue}
              emptyLabel={empty}
              copyLabel={t('appointments.detail.copyPhone', 'Copy phone')}
              copiedLabel={t('appointments.detail.copied', 'Copied')}
              copyFailedLabel={t('appointments.detail.copyFailed', 'Could not copy to the clipboard.')}
              icon={<Phone className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <CopyField
              label={t('appointments.detail.field.email')}
              value={detail.customerEmail || ''}
              emptyLabel={empty}
              copyLabel={t('appointments.detail.copyEmail', 'Copy email')}
              copiedLabel={t('appointments.detail.copied', 'Copied')}
              copyFailedLabel={t('appointments.detail.copyFailed', 'Could not copy to the clipboard.')}
              icon={<Mail className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <Field
              label={t('appointments.detail.field.origin')}
              value={detail.customerOrigin || empty}
              icon={<Globe2 className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <Field
              label={t('appointments.detail.field.referral')}
              value={detail.customerSource || empty}
              icon={<Megaphone className="size-4" aria-hidden="true" />}
              layout="row"
            />
          </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
            {t('appointments.detail.group.visit')}
          </h2>
          <div className="divide-y divide-border">
            <Field
              label={t('appointments.detail.field.location', 'Location')}
              value={detail.organizationName || empty}
              icon={<MapPin className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <Field
              label={t('appointments.detail.field.bookingType')}
              value={formatBookingType(detail.bookingType, empty)}
              icon={<ClipboardList className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <Field
              label={t('appointments.detail.field.requestedStart')}
              value={formatDateTime(detail.requestedStartAt, empty)}
              icon={<Clock3 className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <Field
              label={t('appointments.detail.field.requestedEnd')}
              value={formatDateTime(detail.requestedEndAt, empty)}
              icon={<Clock3 className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <Field
              label={t('appointments.detail.field.notes')}
              value={detail.notes || empty}
              icon={<FileText className="size-4" aria-hidden="true" />}
              layout="row"
            />
            <Field
              label={t('appointments.detail.field.externalNotes')}
              value={detail.externalNotes || empty}
              icon={<MessageSquare className="size-4" aria-hidden="true" />}
              layout="row"
            />
          </div>
            </section>
          </div>

        <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t('appointments.detail.group.services')}
          </h2>
          <div className="space-y-3">
            {detail.lines.map((line, index) => {
              const basePrice = numericValue(line.unitPriceGross)
              const optionTotal = line.options.reduce((total, option) => total + (numericValue(option.priceFlat) ?? 0), 0)
              const subtotal = basePrice == null && optionTotal === 0 ? null : (basePrice ?? 0) + optionTotal

              return (
                <article key={line.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {line.productCategory ? (
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {line.productCategory}
                        </p>
                      ) : null}
                      <h3 className="mt-1 text-base font-semibold text-foreground">
                        {index + 1}. {line.productTitle}
                      </h3>
                    </div>
                    {line.durationMinutes != null ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground">
                        <Clock3 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        {line.durationMinutes} {t('appointments.seatPlanner.minutesShort', 'min')}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 border-y border-border py-2.5 sm:grid-cols-2">
                    <Field
                      label={t('appointments.detail.field.duration')}
                      value={line.durationMinutes != null ? `${line.durationMinutes} ${t('appointments.seatPlanner.minutesShort', 'min')}` : empty}
                      icon={<Clock3 className="size-3.5" aria-hidden="true" />}
                    />
                    <Field
                      label={t('appointments.detail.field.price')}
                      value={formatCurrency(line.unitPriceGross, line.currencyCode) ?? empty}
                      icon={<DollarSign className="size-3.5" aria-hidden="true" />}
                    />
                  </div>

                  {line.options.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                        <ListChecks className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        <span>{t('appointments.seatPlanner.options', 'Options')}</span>
                      </div>
                      <div className="space-y-1.5">
                        {line.options.map((option, optionIndex) => (
                          <div key={`${option.groupName ?? 'option'}-${option.name}-${optionIndex}`} className="flex items-start justify-between gap-3 text-sm">
                            <span className="min-w-0 text-muted-foreground">
                              {option.groupName ? <span className="mr-1.5">{option.groupName}:</span> : null}
                              <span className="font-medium text-foreground">{option.name}</span>
                            </span>
                            {option.priceFlat != null ? (
                              <span className="shrink-0 text-sm font-medium text-foreground">
                                +{formatCurrency(option.priceFlat, line.currencyCode) ?? option.priceFlat}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                    <span className="text-sm font-semibold text-foreground">{t('appointments.detail.subtotal', 'Subtotal')}</span>
                    <span className="text-base font-semibold text-foreground">
                      {subtotal == null
                        ? empty
                        : formatCurrency(String(subtotal), line.currencyCode) ?? String(subtotal)}
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
            <span className="text-base font-semibold text-foreground">{t('appointments.detail.totalAmount', 'Total amount')}</span>
            <span className="text-xl font-semibold text-foreground">
              {formatCurrency(String(totalAmount), totalCurrencyCode) ?? String(totalAmount)}
            </span>
          </div>
        </section>
        </div>
      </PageBody>
    </Page>
  )
}
