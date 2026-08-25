"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

type Line = {
  id: string
  productTitle: string
  durationMinutes: number | null
  unitPriceGross: string | null
  currencyCode: string | null
}

type Detail = {
  id: string
  customerName: string
  customerSalutation: string | null
  customerPhone: string | null
  customerEmail: string | null
  statusCode: string
  requestedStartAt: string
  requestedEndAt: string | null
  notes: string | null
  lines: Line[]
}

type StatusOption = { code: string; label: string }

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  )
}

export default function AppointmentDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [detail, setDetail] = React.useState<Detail | null>(null)
  const [statuses, setStatuses] = React.useState<StatusOption[]>([])
  const [statusCode, setStatusCode] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation } = useGuardedMutation({
    contextId: 'appointments.detail.status',
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      setIsLoading(true)
      setError(null)
      setNotFound(false)
      const [detailCall, statusCall] = await Promise.all([
        apiCall<Detail>(`/api/appointments/${encodeURIComponent(id)}`, undefined, { fallback: null }),
        apiCall<{ items?: StatusOption[] }>('/api/appointments/statuses', undefined, {
          fallback: { items: [] },
        }),
      ])
      if (cancelled) return
      if (statusCall.ok) {
        setStatuses(statusCall.result?.items ?? [])
      }
      if (detailCall.ok && detailCall.result?.id) {
        setDetail(detailCall.result)
        setStatusCode(detailCall.result.statusCode)
      } else if (detailCall.status === 404) {
        setNotFound(true)
      } else {
        setError(t('appointments.detail.error.loadFailed'))
      }
      setIsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, t])

  const handleSaveStatus = React.useCallback(async () => {
    if (!id || !statusCode) return
    try {
      const updated = await runMutation({
        operation: async () => {
          const call = await apiCall<Detail>(
            `/api/appointments/${encodeURIComponent(id)}`,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ statusCode }),
            },
            { fallback: null },
          )
          if (!call.ok || !call.result?.id) {
            const errorPayload = call.result as { error?: string } | undefined
            throw new Error(
              typeof errorPayload?.error === 'string'
                ? errorPayload.error
                : t('appointments.status.failed'),
            )
          }
          return call.result
        },
        context: {},
      })
      setDetail(updated)
      setStatusCode(updated.statusCode)
      flash(t('appointments.detail.statusSaved'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('appointments.status.failed'), 'error')
    }
  }, [id, statusCode, runMutation, t])

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

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('appointments.detail.title')}</h1>
            <p className="text-sm text-muted-foreground">{detail.customerName}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/backend/appointments">{t('appointments.list.title')}</Link>
          </Button>
        </div>

        <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t('appointments.detail.group.customer')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('appointments.detail.field.name')} value={detail.customerName} />
            <Field
              label={t('appointments.detail.field.salutation')}
              value={detail.customerSalutation || empty}
            />
            <Field label={t('appointments.detail.field.phone')} value={detail.customerPhone || empty} />
            <Field label={t('appointments.detail.field.email')} value={detail.customerEmail || empty} />
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t('appointments.detail.group.visit')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label={t('appointments.detail.field.requestedStart')}
              value={formatDateTime(detail.requestedStartAt, empty)}
            />
            <Field
              label={t('appointments.detail.field.requestedEnd')}
              value={formatDateTime(detail.requestedEndAt, empty)}
            />
            <Field label={t('appointments.detail.field.notes')} value={detail.notes || empty} />
            <div className="space-y-2 sm:col-span-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('appointments.detail.field.status')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 rounded-md border border-border bg-input-bg px-2 text-sm"
                  value={statusCode}
                  onChange={(event) => setStatusCode(event.target.value)}
                >
                  {statuses.map((status) => (
                    <option key={status.code} value={status.code}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={() => {
                    void handleSaveStatus()
                  }}
                  disabled={statusCode === detail.statusCode}
                >
                  {t('appointments.detail.saveStatus')}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t('appointments.detail.group.services')}
          </h2>
          <ul className="divide-y divide-border">
            {detail.lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="text-sm font-medium text-foreground">{line.productTitle}</span>
                <span className="text-sm text-muted-foreground">
                  {[
                    line.durationMinutes != null ? `${line.durationMinutes} min` : null,
                    line.unitPriceGross
                      ? `${line.unitPriceGross}${line.currencyCode ? ` ${line.currencyCode}` : ''}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || empty}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </PageBody>
    </Page>
  )
}
