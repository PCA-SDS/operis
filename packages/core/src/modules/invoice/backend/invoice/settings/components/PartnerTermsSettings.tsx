'use client'

import * as React from 'react'
import { Search } from 'lucide-react'
import { useInvoiceT as useT } from '@open-mercato/core/modules/invoice/lib/useInvoiceT'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

const PAGE_SIZE = 20
const MAX_DUE_DAYS = 3650

type Partner = {
  id: string
  name: string
  taxCode: string
  countryCode: string
  defaultDueDays: number | null
  updatedAt: string | null
}

type PartnerListResponse = {
  items: Partner[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type PartnerUpdateResponse = { ok: true; partner: Partner }
type ErrorResponse = { error?: string }

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value && typeof (value as ErrorResponse).error === 'string') {
    return (value as ErrorResponse).error || fallback
  }
  return fallback
}

export function PartnerTermsSettings() {
  const t = useT()
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [payload, setPayload] = React.useState<PartnerListResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [updatingId, setUpdatingId] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'invoice.settings.partner-terms' })

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (search) params.set('search', search)
    try {
      const call = await apiCall<PartnerListResponse>(`/api/invoice/partners?${params.toString()}`, undefined, { fallback: null })
      if (!call.ok || !call.result) {
        setLoadError(true)
        return
      }
      setPayload(call.result)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  React.useEffect(() => { void load() }, [load])

  const updatePartner = React.useCallback(async (partner: Partner, defaultDueDays: number | null) => {
    setUpdatingId(partner.id)
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(buildOptimisticLockHeader(partner.updatedAt), () => (
            apiCall<PartnerUpdateResponse>(`/api/invoice/partners/${encodeURIComponent(partner.id)}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ defaultDueDays }),
            }, { fallback: null })
          ))
          if (!call.ok || !call.result?.ok) {
            if (surfaceRecordConflict({ status: call.status, body: call.result }, t)) {
              throw new Error(t('invoice.settings.partnerTerms.conflict'))
            }
            throw new Error(errorMessage(call.result, t('invoice.settings.partnerTerms.saveFailed')))
          }
          return call.result
        },
        context: { partnerId: partner.id, resourceKind: 'invoice.company', retryLastMutation },
        mutationPayload: { defaultDueDays },
      })
      flash(t(defaultDueDays === null ? 'invoice.settings.partnerTerms.cleared' : 'invoice.settings.partnerTerms.saved', {
        partner: partner.name,
        days: defaultDueDays ?? '',
      }), 'success')
      await load()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('invoice.settings.partnerTerms.saveFailed'), 'error')
    } finally {
      setUpdatingId(null)
    }
  }, [load, retryLastMutation, runMutation, t])

  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">{t('invoice.settings.partnerTerms.searchLabel')}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t('invoice.settings.partnerTerms.searchPlaceholder')}
          aria-label={t('invoice.settings.partnerTerms.searchLabel')}
          className="pl-9"
        />
      </label>

      {loadError ? (
        <Alert status="error" style="lighter" action={<Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>}>
          {t('invoice.settings.partnerTerms.loadFailed')}
        </Alert>
      ) : loading && !payload ? (
        <div className="flex min-h-40 items-center justify-center"><Spinner /></div>
      ) : (payload?.items.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t(search ? 'invoice.settings.partnerTerms.noSearchResults' : 'invoice.settings.partnerTerms.empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t(search ? 'invoice.settings.partnerTerms.noSearchResultsDescription' : 'invoice.settings.partnerTerms.emptyDescription')}</p>
        </div>
      ) : (
        <div className={loading ? 'opacity-60' : undefined} aria-busy={loading}>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
              <span>{t('invoice.settings.partnerTerms.partner')}</span>
              <span className="text-right">{t('invoice.settings.partnerTerms.dueDays')}</span>
            </div>
            <ul className="divide-y divide-border">
              {payload?.items.map((partner) => (
                <PartnerRow key={partner.id} partner={partner} busy={updatingId === partner.id} onSave={updatePartner} />
              ))}
            </ul>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t('invoice.settings.partnerTerms.resultCount', { count: payload?.total ?? 0 })}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>{t('invoice.settings.previous')}</Button>
              <Button type="button" variant="outline" size="sm" disabled={page >= (payload?.totalPages ?? 1) || loading} onClick={() => setPage((value) => value + 1)}>{t('invoice.settings.next')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PartnerRow({ partner, busy, onSave }: { partner: Partner; busy: boolean; onSave: (partner: Partner, days: number | null) => Promise<void> }) {
  const t = useT()
  const savedValue = partner.defaultDueDays === null ? '' : String(partner.defaultDueDays)
  const [value, setValue] = React.useState(savedValue)
  const [validationError, setValidationError] = React.useState<string | null>(null)

  React.useEffect(() => setValue(savedValue), [savedValue])

  const commit = React.useCallback(() => {
    if (value === savedValue || busy) return
    if (value === '') {
      setValidationError(null)
      void onSave(partner, null)
      return
    }
    const days = Number(value)
    if (!Number.isInteger(days) || days < 1 || days > MAX_DUE_DAYS) {
      setValidationError(t('invoice.settings.partnerTerms.validation', { max: MAX_DUE_DAYS }))
      return
    }
    setValidationError(null)
    void onSave(partner, days)
  }, [busy, onSave, partner, savedValue, t, value])

  const visibleTaxCode = partner.taxCode.startsWith('auto:') ? null : partner.taxCode
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{partner.name}</p>
        <p className="truncate text-xs text-muted-foreground">{[visibleTaxCode, partner.countryCode].filter(Boolean).join(' · ')}</p>
      </div>
      <div>
        <div className="flex items-center justify-end gap-2">
          <Input
            inputMode="numeric"
            value={value}
            onChange={(event) => { setValue(event.target.value.replace(/\D/g, '').slice(0, 4)); setValidationError(null) }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commit() }
              if (event.key === 'Escape') { setValue(savedValue); setValidationError(null) }
            }}
            aria-label={t('invoice.settings.partnerTerms.inputLabel', { partner: partner.name })}
            disabled={busy}
            className="h-8 w-20 text-right tabular-nums"
          />
          {busy ? <Spinner size="sm" /> : <span className="text-xs text-muted-foreground">{t('invoice.settings.partnerTerms.days')}</span>}
        </div>
        {validationError ? <p role="alert" className="mt-1 text-right text-xs text-status-error-text">{validationError}</p> : null}
      </div>
    </li>
  )
}
