"use client"

import * as React from 'react'
import { Check, Pencil, Sparkles } from 'lucide-react'
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
  /** Section heading this row sorts under. Rows with no category share one group. */
  category?: string | null
  /** Prerequisites the operator has not granted; the row reads as blocked until they are. */
  missingDependencies?: string[]
  /** Modules that lose reachability if this row is switched off. */
  dependents?: string[]
  /** ISO-8601 grant window, rendered as "Since … until …" when present. */
  startsAt?: string | null
  endsAt?: string | null
  /** Whether this module ships an AI assistant that can be entitled separately. */
  aiAssistantAvailable?: boolean
  aiAssistantEnabled?: boolean
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
  /** Grant-window wording. Omit to hide the dates entirely. */
  since?: (date: string) => string
  until?: (date: string) => string
  /** AI sub-toggle wording. Omit to hide the sub-row entirely. */
  aiAssistant?: string
  aiOn?: string
  aiOff?: string
  aiToggleAriaLabel?: (row: ModuleAccessRow, next: boolean) => string
}

export type ModuleAccessSectionProps = {
  rows: ModuleAccessRow[]
  labels: ModuleAccessLabels
  onToggle: (row: ModuleAccessRow, next: boolean) => Promise<void>
  /**
   * Applies the AI sub-toggle. Omit on screens that do not govern it — the
   * sub-row then never renders, which is how the per-user screen opts out.
   */
  onToggleAiAssistant?: (row: ModuleAccessRow, next: boolean) => Promise<void>
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
  onToggleAiAssistant,
  headerAside,
  className,
}: ModuleAccessSectionProps) {
  const [editMode, setEditMode] = React.useState(false)
  const [pending, setPending] = React.useState<{ row: ModuleAccessRow; next: boolean } | null>(null)
  const [submitting, setSubmitting] = React.useState<string | null>(null)
  const [aiSubmitting, setAiSubmitting] = React.useState<string | null>(null)
  const [checks, setChecks] = React.useState<boolean[]>([])

  // The AI sub-toggle is deliberately NOT behind the attestation dialog: it
  // narrows an affordance inside a surface the tenant keeps, where the module
  // switch removes the surface itself. Same reveal, far lower stakes.
  const toggleAi = React.useCallback(async (row: ModuleAccessRow, next: boolean) => {
    if (!onToggleAiAssistant) return
    setAiSubmitting(row.moduleId)
    try {
      await onToggleAiAssistant(row, next)
    } finally {
      setAiSubmitting(null)
    }
  }, [onToggleAiAssistant])

  const groups = React.useMemo(() => groupRowsByCategory(rows), [rows])

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
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.category} aria-label={group.category}>
              {groups.length > 1 ? (
                <h3 className="mb-2 text-overline text-muted-foreground">{group.category}</h3>
              ) : null}
              <ul className="divide-y divide-border rounded-xl bg-surface shadow-md">
                {group.rows.map((row) => {
                  const blockedBy = row.missingDependencies ?? []
                  const cascade = row.dependents ?? []
                  const showAi = Boolean(
                    onToggleAiAssistant
                    && labels.aiAssistant
                    && row.aiAssistantAvailable
                    && row.isEnabled
                    && !row.alwaysOn,
                  )
                  return (
                    <li key={row.moduleId} className="px-5 py-4 sm:px-6">
                      <div className="flex flex-col gap-2">
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
                          <GrantWindow row={row} labels={labels} />
                        </div>

                        {showAi ? (
                          <div className="flex items-center pl-1 sm:pl-9">
                            <EditReveal show={editMode} width="max-w-14" gap="mr-2">
                              <Switch
                                checked={row.aiAssistantEnabled === true}
                                disabled={aiSubmitting !== null}
                                onCheckedChange={(next) => { void toggleAi(row, next) }}
                                tabIndex={editMode ? undefined : -1}
                                aria-label={(labels.aiToggleAriaLabel ?? labels.toggleAriaLabel)(row, row.aiAssistantEnabled !== true)}
                              />
                            </EditReveal>
                            <div className="flex min-w-0 items-center gap-2">
                              <Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
                              <span className="text-xs text-muted-foreground">{labels.aiAssistant}</span>
                              <Badge variant={row.aiAssistantEnabled ? 'success' : 'neutral'} size="sm">
                                {row.aiAssistantEnabled ? labels.aiOn : labels.aiOff}
                              </Badge>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
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
function EditReveal({
  show,
  width = 'max-w-14',
  gap = 'mr-3',
  children,
}: {
  show: boolean
  width?: string
  gap?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-out',
        show ? `${width} opacity-100 ${gap}` : 'max-w-0 opacity-0 mr-0 pointer-events-none',
      )}
      aria-hidden={!show}
    >
      {children}
    </div>
  )
}

/**
 * "Since 3 Feb 2026 — until 9 Aug 2026".
 *
 * Renders nothing without `labels.since`, so a screen that has no grant window
 * to report (the per-user restriction screen) simply omits the wording rather
 * than passing empty dates.
 */
function GrantWindow({ row, labels }: { row: ModuleAccessRow; labels: ModuleAccessLabels }) {
  if (!labels.since || row.alwaysOn) return null
  const started = formatGrantDate(row.startsAt)
  if (!started) return null
  const ended = labels.until ? formatGrantDate(row.endsAt) : null
  return (
    <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
      <span>{labels.since(started)}</span>
      {ended ? <span className="ml-2">{labels.until!(ended)}</span> : null}
    </div>
  )
}

/** Locale-aware short date; `null` for anything unparseable, so the row degrades to no window. */
function formatGrantDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Groups rows under their category heading, preserving the order the server
 * sent — the service already sorts by category, rank and title, and re-sorting
 * here would let the two disagree.
 */
function groupRowsByCategory(rows: ModuleAccessRow[]): Array<{ category: string; rows: ModuleAccessRow[] }> {
  const groups: Array<{ category: string; rows: ModuleAccessRow[] }> = []
  const byCategory = new Map<string, ModuleAccessRow[]>()
  for (const row of rows) {
    const category = row.category && row.category.length ? row.category : ''
    let bucket = byCategory.get(category)
    if (!bucket) {
      bucket = []
      byCategory.set(category, bucket)
      groups.push({ category, rows: bucket })
    }
    bucket.push(row)
  }
  return groups
}
