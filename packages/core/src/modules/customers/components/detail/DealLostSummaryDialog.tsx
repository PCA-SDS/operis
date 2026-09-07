"use client"

import * as React from 'react'
import { CircleOff, Clock3, FileWarning, Radar } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'

type DealStatsPayload = {
  dealValue: number | null
  dealCurrency: string | null
  closureOutcome: 'won' | 'lost'
  closedAt: string
  pipelineName: string | null
  dealsClosedThisPeriod: number
  salesCycleDays: number | null
  dealRankInQuarter: number | null
  lossReason: string | null
}

type DealLostSummaryDialogProps = {
  open: boolean
  onClose: () => void
  dealTitle: string
  lossNotes?: string | null
  stats: DealStatsPayload | null
  onBackToPipeline?: () => void
  onScheduleFollowUp?: () => void
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (!currency) return value.toLocaleString()
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toLocaleString()} ${currency}`
  }
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border bg-surface px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

export function DealLostSummaryDialog({
  open,
  onClose,
  dealTitle,
  lossNotes,
  stats,
  onBackToPipeline,
  onScheduleFollowUp,
}: DealLostSummaryDialogProps) {
  const t = useT()

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="overflow-hidden sm:max-w-[420px]">
        <DialogBody className="min-h-0 flex-1 space-y-5 overflow-y-auto pt-6 text-center">
          <div className="flex h-[200px] items-center justify-center rounded-2xl bg-muted/30 text-foreground">
            <CircleOff className="size-24" strokeWidth={1.5} />
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <DialogTitle className="text-2xl font-bold leading-tight">
                {t('customers.deals.detail.lost.popupTitle', 'Not this round')}
              </DialogTitle>
              <p className="text-sm font-medium text-muted-foreground">
                {t('customers.deals.detail.lost.popupSubtitle', 'Even great teams miss a shot sometimes')}
              </p>
            </div>

            <div className="rounded-xl border bg-muted/20 px-4 py-4">
              <p className="text-overline font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {dealTitle}
              </p>
              <p className="mt-2 text-2xl font-bold text-muted-foreground">
                {stats ? formatCurrency(stats.dealValue, stats.dealCurrency) : '—'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('customers.deals.detail.lost.popupSummary', 'Lost · reason: {{reason}}', {
                  reason: stats?.lossReason ?? t('customers.deals.detail.lost.reasonFallback', 'Unknown'),
                })}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatCard
                icon={<Radar className="size-4" />}
                label={t('customers.deals.detail.lost.dealsThisWeek', 'Lost this week')}
                value={stats ? String(stats.dealsClosedThisPeriod) : '—'}
              />
              <StatCard
                icon={<Clock3 className="size-4" />}
                label={t('customers.deals.detail.lost.salesCycle', 'Sales cycle')}
                value={stats?.salesCycleDays !== null && stats?.salesCycleDays !== undefined ? `${stats.salesCycleDays}d` : '—'}
              />
              <StatCard
                icon={<FileWarning className="size-4" />}
                label={t('customers.deals.detail.lost.reason', 'Loss reason')}
                value={stats?.lossReason ?? '—'}
              />
            </div>

            {lossNotes ? (
              <div className="rounded-xl bg-primary/15 px-4 py-4 text-left">
                <div className="text-overline font-bold uppercase tracking-[0.16em] text-foreground">
                  {t('customers.deals.detail.lost.nextHeading', "What's next")}
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{lossNotes}</div>
              </div>
            ) : null}

          </div>
        </DialogBody>
        <DialogFooter className="flex-col gap-2">
          <Button
            type="button"
            className="w-full"
            onClick={onBackToPipeline ?? onClose}
          >
            {t('customers.deals.detail.lost.primaryAction', 'Back to pipeline')}
          </Button>
          {onScheduleFollowUp ? (
            <Button type="button" variant="outline" className="w-full" onClick={onScheduleFollowUp}>
              {t('customers.deals.detail.lost.secondaryAction', 'Set reminder for Q3')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
