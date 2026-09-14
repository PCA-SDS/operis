'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type AutoPaidRule = { id: string; taxCode: string; updatedAt: string | null }
type Candidate = { taxCode: string; invoiceCount: number }
type RulesResponse = { items: AutoPaidRule[] }
type CandidatesResponse = { items: Candidate[] }
type AddResponse = { ok: true; ruleId: string; taxCode: string; settledCount: number }
type RemoveResponse = { ok: true; ruleId: string; taxCode: string; revertedCount: number }
type ErrorResponse = { error?: string }

function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value && typeof (value as ErrorResponse).error === 'string') {
    return (value as ErrorResponse).error || fallback
  }
  return fallback
}

export function AutoPaidSettings() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rules, setRules] = React.useState<AutoPaidRule[]>([])
  const [candidates, setCandidates] = React.useState<Candidate[]>([])
  const [taxCode, setTaxCode] = React.useState('')
  const [candidate, setCandidate] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation, isPending } = useGuardedMutation({ contextId: 'invoice.settings.auto-paid' })

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [rulesCall, candidatesCall] = await Promise.all([
        apiCall<RulesResponse>('/api/invoice/auto-paid', undefined, { fallback: null }),
        apiCall<CandidatesResponse>('/api/invoice/auto-paid/candidates', undefined, { fallback: null }),
      ])
      if (!rulesCall.ok || !rulesCall.result || !candidatesCall.ok || !candidatesCall.result) {
        setLoadError(true)
        return
      }
      setRules(rulesCall.result.items)
      setCandidates(candidatesCall.result.items)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const addRule = React.useCallback(async (rawTaxCode: string) => {
    const value = rawTaxCode.trim()
    if (!value) {
      flash(t('invoice.settings.autoPaid.taxCodeRequired'), 'error')
      return
    }
    if (rules.some((rule) => rule.taxCode === value)) {
      flash(t('invoice.settings.autoPaid.duplicate'), 'error')
      return
    }
    try {
      const result = await runMutation({
        operation: async () => {
          const call = await apiCall<AddResponse>('/api/invoice/auto-paid', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ taxCode: value }),
          }, { fallback: null })
          if (!call.ok || !call.result?.ok) throw new Error(responseError(call.result, t('invoice.settings.autoPaid.addFailed')))
          return call.result
        },
        context: { resourceKind: 'invoice.auto_paid_tax_code', retryLastMutation },
        mutationPayload: { taxCode: value },
      })
      flash(t('invoice.settings.autoPaid.added', { taxCode: result.taxCode, count: result.settledCount }), 'success')
      setTaxCode('')
      setCandidate('')
      await load()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('invoice.settings.autoPaid.addFailed'), 'error')
    }
  }, [load, retryLastMutation, rules, runMutation, t])

  const removeRule = React.useCallback(async (rule: AutoPaidRule) => {
    const accepted = await confirm({
      title: t('invoice.settings.autoPaid.removeTitle'),
      text: t('invoice.settings.autoPaid.removeDescription', { taxCode: rule.taxCode }),
      confirmText: t('invoice.settings.autoPaid.remove'),
      cancelText: t('invoice.settings.cancel'),
      variant: 'destructive',
    })
    if (!accepted) return
    setRemovingId(rule.id)
    try {
      const result = await runMutation({
        operation: async () => {
          const call = await apiCall<RemoveResponse>(`/api/invoice/auto-paid/${encodeURIComponent(rule.id)}`, { method: 'DELETE' }, { fallback: null })
          if (!call.ok || !call.result?.ok) throw new Error(responseError(call.result, t('invoice.settings.autoPaid.removeFailed')))
          return call.result
        },
        context: { ruleId: rule.id, resourceKind: 'invoice.auto_paid_tax_code', retryLastMutation },
        mutationPayload: { id: rule.id },
      })
      flash(t('invoice.settings.autoPaid.removed', { taxCode: result.taxCode, count: result.revertedCount }), 'success')
      await load()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('invoice.settings.autoPaid.removeFailed'), 'error')
    } finally {
      setRemovingId(null)
    }
  }, [confirm, load, retryLastMutation, runMutation, t])

  const availableCandidates = candidates.filter((item) => !rules.some((rule) => rule.taxCode === item.taxCode))

  return (
    <div className="space-y-4">
      <Alert status="warning" style="lighter">{t('invoice.settings.autoPaid.warning')}</Alert>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={candidate}
          onChange={(event) => setCandidate(event.target.value)}
          aria-label={t('invoice.settings.autoPaid.candidateLabel')}
          disabled={loading || isPending}
          className="h-10 rounded-lg border border-border bg-input-bg px-3 text-sm text-foreground"
        >
          <option value="">{t('invoice.settings.autoPaid.candidatePlaceholder')}</option>
          {availableCandidates.map((item) => <option key={item.taxCode} value={item.taxCode}>{t('invoice.settings.autoPaid.candidateOption', { taxCode: item.taxCode, count: item.invoiceCount })}</option>)}
        </select>
        <Button type="button" variant="outline" disabled={!candidate || isPending} onClick={() => void addRule(candidate)}>
          <Plus className="size-4" aria-hidden="true" />{t('invoice.settings.autoPaid.addCandidate')}
        </Button>
      </div>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void addRule(taxCode) }}>
        <Input value={taxCode} onChange={(event) => setTaxCode(event.target.value)} placeholder={t('invoice.settings.autoPaid.taxCodePlaceholder')} aria-label={t('invoice.settings.autoPaid.taxCodeLabel')} disabled={isPending} maxLength={80} />
        <Button type="submit" disabled={!taxCode.trim() || isPending}><Plus className="size-4" aria-hidden="true" />{t('invoice.settings.autoPaid.add')}</Button>
      </form>

      {loadError ? (
        <Alert status="error" style="lighter" action={<Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{t('invoice.actions.retry')}</Button>}>
          {t('invoice.settings.autoPaid.loadFailed')}
        </Alert>
      ) : loading && rules.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center"><Spinner /></div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('invoice.settings.autoPaid.empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('invoice.settings.autoPaid.emptyDescription')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border" aria-busy={loading}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            <span>{t('invoice.settings.autoPaid.taxCode')}</span><span>{t('invoice.settings.autoPaid.actions')}</span>
          </div>
          <ul className="divide-y divide-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 px-3 py-3">
                <span className="truncate font-mono text-sm text-foreground">{rule.taxCode}</span>
                <Button type="button" variant="ghost" size="sm" disabled={isPending} aria-label={t('invoice.settings.autoPaid.removeLabel', { taxCode: rule.taxCode })} onClick={() => void removeRule(rule)}>
                  {removingId === rule.id ? <Spinner size="sm" /> : <Trash2 className="size-4" aria-hidden="true" />}
                  {t('invoice.settings.autoPaid.remove')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
