'use client'

import * as React from 'react'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ActionLogItem } from './AuditLogsActions'
import {
  ChangedFieldsTable,
  CollapsibleJsonSection,
  extractChangeRows,
  formatDate,
  formatResource,
} from '../lib/display-helpers'

export function ActionLogDetailsDialog({ item, onClose }: { item: ActionLogItem; onClose: () => void }) {
  const t = useT()
  const noneLabel = t('audit_logs.common.none')

  const changeRows = React.useMemo(
    () => extractChangeRows(item.changes, item.snapshotBefore),
    [item.changes, item.snapshotBefore],
  )

  const hasContext = !!item.context && typeof item.context === 'object' && Object.keys(item.context).length > 0
  const snapshots = React.useMemo(() => {
    const entries: { label: string; value: unknown }[] = []
    if (item.snapshotBefore != null) {
      entries.push({ label: t('audit_logs.actions.details.snapshot_before'), value: item.snapshotBefore })
    }
    if (item.snapshotAfter != null) {
      entries.push({ label: t('audit_logs.actions.details.snapshot_after'), value: item.snapshotAfter })
    }
    return entries
  }, [item.snapshotAfter, item.snapshotBefore, t])

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        size="lg"
        className="max-h-[90vh] overflow-hidden sm:max-w-3xl"
        closeAriaLabel={t('audit_logs.actions.details.close')}
      >
        <DialogHeader>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t('audit_logs.actions.details.title')}
          </p>
          <DialogTitle className="truncate">
            {item.actionLabel || item.commandId}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {formatDate(item.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
          <section className="space-y-3 text-sm">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.action')}
                </dt>
                <dd className="text-sm">{item.actionLabel || item.commandId}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.resource')}
                </dt>
                <dd className="text-sm break-words">
                  {formatResource(item, noneLabel)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.user')}
                </dt>
                <dd className="text-sm">{item.actorUserName || item.actorUserId || noneLabel}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('audit_logs.actions.columns.status')}
                </dt>
                <dd className="text-sm capitalize">{item.executionState}</dd>
              </div>
            </dl>
          </section>

          <ChangedFieldsTable changeRows={changeRows} noneLabel={noneLabel} t={t} />

          {hasContext ? (
            <section>
              <CollapsibleJsonSection label={t('audit_logs.actions.details.context')} value={item.context} />
            </section>
          ) : null}

          {snapshots.length ? (
            <section className="space-y-4">
              {snapshots.map((entry) => (
                <CollapsibleJsonSection key={entry.label} label={entry.label} value={entry.value} />
              ))}
            </section>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
