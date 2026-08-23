"use client"

import * as React from 'react'
import { Check, Pencil } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Switch } from '../../primitives/switch'
import { Badge } from '../../primitives/badge'
import { Button } from '../../primitives/button'
import { EmptyState } from '../../primitives/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../primitives/dialog'
import { CheckboxField } from '../../primitives/checkbox-field'

export type ModuleAccessRow = {
  moduleId: string
  title: string
  description?: string | null
  isEnabled: boolean
  /** Rendered as a non-toggleable "Core" row — the platform always provides it. */
  alwaysOn?: boolean
  /** Prerequisites the operator has not granted; the row reads as blocked until they are. */
  missingDependencies?: string[]
  /** Modules that lose reachability if this row is switched off. */
  dependents?: string[]
}

export type ModuleAccessLabels = {
  heading: string
  edit: string
  done: string
  enabled: string
  disabled: string
  core: string
  blocked: (dependencies: string) => string
  cascade: (dependents: string) => string
  emptyTitle: string
  emptyDescription: string
  confirmTitle: (row: ModuleAccessRow, next: boolean) => string
  confirmBody: (row: ModuleAccessRow, next: boolean) => string
  /** Statements the operator must tick before the destructive action unlocks. */
  attestations: string[]
  confirmCta: (next: boolean) => string
  cancel: string
  toggleAriaLabel: (row: ModuleAccessRow, next: boolean) => string
}

export type ModuleAccessSectionProps = {
  rows: ModuleAccessRow[]
  labels: ModuleAccessLabels
  onToggle: (row: ModuleAccessRow, next: boolean) => Promise<void>
  /** Optional right-hand slot in the header (counts, links). */
  headerAside?: React.ReactNode
  className?: string
}

/**
 * The module entitlement surface, shared by the platform (tenant) screen and the
 * tenant-admin (per-user) screen so both read identically and there is one
 * implementation to keep correct.
 *
 * Modelled on PCA ERP's staff-admin `CompanyModulesSection`: a plain read-only
 * list by default, an explicit Edit mode that reveals the switches, and a
 * confirmation dialog with attestations before anything changes. The friction is
 * the point — an entitlement toggle changes what a whole company or person can
 * reach, so it should not be a stray click on a hover target.
 */
export function ModuleAccessSection({
  rows,
  labels,
  onToggle,
  headerAside,
  className,
}: ModuleAccessSectionProps) {
  const [editMode, setEditMode] = React.useState(false)
  const [pending, setPending] = React.useState<{ row: ModuleAccessRow; next: boolean } | null>(null)
  const [submitting, setSubmitting] = React.useState<string | null>(null)
  const [checks, setChecks] = React.useState<boolean[]>([])

  const openConfirm = React.useCallback((row: ModuleAccessRow, next: boolean) => {
    if (row.alwaysOn) return
    setChecks(labels.attestations.map(() => false))
    setPending({ row, next })
  }, [labels.attestations])

  const closeConfirm = React.useCallback(() => {
    if (submitting) return
    setPending(null)
  }, [submitting])

  const confirm = React.useCallback(async () => {
    if (!pending) return
    setSubmitting(pending.row.moduleId)
    try {
      await onToggle(pending.row, pending.next)
      setPending(null)
    } finally {
      setSubmitting(null)
    }
  }, [pending, onToggle])

  const allChecked = checks.length === 0 || checks.every(Boolean)

  return (
    <section aria-labelledby="module-access-heading" className={cn('flex flex-col', className)}>
      <header className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="module-access-heading" className="text-2xl font-semibold text-foreground">
          {labels.heading}
        </h2>
        <div className="flex items-center gap-3">
          {headerAside}
          {rows.length > 0 ? (
            <Button
              type="button"
              variant={editMode ? 'default' : 'outline'}
              size="sm"
              aria-pressed={editMode}
              onClick={() => setEditMode((value) => !value)}
            >
              {editMode ? <Check className="size-3" aria-hidden /> : <Pencil className="size-3" aria-hidden />}
              {editMode ? labels.done : labels.edit}
            </Button>
          ) : null}
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState title={labels.emptyTitle} description={labels.emptyDescription} />
      ) : (
        <ul className="divide-y divide-border rounded-xl bg-surface shadow-md">
          {rows.map((row) => {
            const blockedBy = row.missingDependencies ?? []
            const cascade = row.dependents ?? []
            return (
              <li key={row.moduleId} className="px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center">
                    <EditReveal show={editMode}>
                      <Switch
                        checked={row.isEnabled}
                        disabled={row.alwaysOn || submitting !== null}
                        onCheckedChange={(next) => openConfirm(row, next)}
                        tabIndex={editMode ? undefined : -1}
                        aria-label={labels.toggleAriaLabel(row, !row.isEnabled)}
                      />
                    </EditReveal>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-semibold text-foreground">{row.title}</span>
                        {row.alwaysOn ? (
                          <Badge variant="success" size="sm">{labels.core}</Badge>
                        ) : (
                          <Badge variant={row.isEnabled ? 'success' : 'neutral'} size="sm">
                            {row.isEnabled ? labels.enabled : labels.disabled}
                          </Badge>
                        )}
                      </div>
                      {row.description ? (
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">{row.description}</p>
                      ) : null}
                      {blockedBy.length > 0 ? (
                        <p className="mt-1 text-xs text-status-warning-text">{labels.blocked(blockedBy.join(', '))}</p>
                      ) : null}
                      {editMode && row.isEnabled && cascade.length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">{labels.cascade(cascade.join(', '))}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) closeConfirm() }}>
        <DialogContent className="sm:max-w-xl">
          {pending ? (
            <>
              <DialogHeader leadingTone={pending.next ? 'success' : 'warning'}>
                <DialogTitle>{labels.confirmTitle(pending.row, pending.next)}</DialogTitle>
                <DialogDescription>{labels.confirmBody(pending.row, pending.next)}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 px-6 py-2">
                {labels.attestations.map((text, index) => (
                  <CheckboxField
                    key={text}
                    label={text}
                    checked={checks[index] ?? false}
                    disabled={submitting !== null}
                    onCheckedChange={(value) => setChecks((prev) => {
                      const next = [...prev]
                      next[index] = value === true
                      return next
                    })}
                  />
                ))}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeConfirm} disabled={submitting !== null}>
                  {labels.cancel}
                </Button>
                <Button
                  type="button"
                  variant={pending.next ? 'default' : 'destructive'}
                  onClick={() => { void confirm() }}
                  disabled={!allChecked || submitting !== null}
                >
                  {labels.confirmCta(pending.next)}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * Collapses the switch out of the row until Edit mode is on, matching PCA's
 * reveal. `max-width` rather than `display` so the row does not jump.
 */
function EditReveal({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-out',
        show ? 'max-w-14 opacity-100 mr-3' : 'max-w-0 opacity-0 mr-0 pointer-events-none',
      )}
      aria-hidden={!show}
    >
      {children}
    </div>
  )
}
