"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { FormFieldLabel } from '@open-mercato/ui/backend/forms/FormSection'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'

/**
 * The editor's field chrome, matching the PCA modal reference rather than the
 * DS form default.
 *
 * A PCA dialog field is a FILLED box with a transparent border and no focus
 * ring — `LOGIN_INPUT_CLASS` in the reference repo, used by every field in
 * `CreateUserDialog`. That is the opposite of the DS `Input`, which is an
 * outlined box, because the DS input has to survive on the page ground where a
 * fill alone would not read as a control. Inside a dialog the panel does that
 * work, so the border comes off.
 *
 * Controls built from DS primitives get this treatment from the
 * `[data-dialog-form]` rule in `globals.css` instead of from a class here — a
 * dialog holds several control families (Input, Select trigger, DatePicker
 * trigger, Textarea) and they must not disagree. `CONTROL_BOX` is for the
 * hand-built boxes (chip pickers, dropdown triggers) that rule cannot reach.
 */
export const CONTROL_BOX = 'rounded-lg border border-transparent bg-surface-muted'
/** Every control in the editor is one height, the same 36px as the app chrome. */
export const CONTROL_HEIGHT = 'h-9'
/**
 * The chip pickers use this instead: empty they match `CONTROL_HEIGHT`, and
 * they grow a line at a time as chips are added. Spelled out rather than
 * composed from `CONTROL_HEIGHT` because Tailwind only sees literal class
 * strings — an interpolated `min-${CONTROL_HEIGHT}` is never emitted.
 */
export const CONTROL_MIN_HEIGHT = 'min-h-9'
/**
 * The field micro-label. Same typography as the shared `FORM_FIELD_LABEL` but
 * without its `mb-2.5`: these labels sit in flex columns that own the spacing,
 * so carrying the margin too would double it.
 */
export const LABEL_CLASS = 'block text-xs font-bold uppercase tracking-wide text-muted-foreground'

export function Field({ label, children, error, className }: { label: string; children: React.ReactNode; error?: string | null; className?: string }) {
  return (
    // `gap-2.5` reproduces the reference label's `mb-2.5`, which `LABEL_CLASS`
    // deliberately drops so the spacing is owned in one place.
    <div className={cn('flex w-full flex-col gap-2.5', className)}>
      <FormFieldLabel className="mb-0">{label}</FormFieldLabel>
      {children}
      {error ? <p className="text-xs text-status-error-text">{error}</p> : null}
    </div>
  )
}

export function UppercaseBadge({ style, className, children }: { style?: React.CSSProperties; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-overline font-medium uppercase text-muted-foreground',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

export function AllDayToggle({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange(next: boolean): void; label: string }) {
  return (
    <Switch
      checked={checked}
      aria-label={label}
      onCheckedChange={onCheckedChange}
      className="h-6 w-10"
    />
  )
}

function parseDateValue(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Close the field's popover when the surrounding editor dialog scrolls, so a
// portalled DS popover (DatePicker/Select) doesn't float over the form or drift
// from its field (#3747 feedback). Radix ignores synthetic dismiss events, so
// this drives the popover's controlled `open` state instead. The editor
// dispatches `EDITOR_SCROLL_EVENT` on scroll.
export const EDITOR_SCROLL_EVENT = 'om-calendar-editor-scroll'
export function useCloseOnEditorScroll(setOpen: (open: boolean) => void) {
  React.useEffect(() => {
    const handler = () => setOpen(false)
    document.addEventListener(EDITOR_SCROLL_EVENT, handler)
    return () => document.removeEventListener(EDITOR_SCROLL_EVENT, handler)
  }, [setOpen])
}

// DS DatePicker (calendar popover) + DS Select (scrolling 30-min list) replace
// the native `<input type=date|time>` overlays, which only opened via the
// browser chevron and did not match the design system (#3747 feedback).
export function DateControl({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: string
  onChange(next: string): void
  ariaLabel: string
  locale: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  useCloseOnEditorScroll(setOpen)
  return (
    <DatePicker
      value={parseDateValue(value)}
      onChange={(date) => { if (date) onChange(formatDateValue(date)) }}
      footer="none"
      open={open}
      onOpenChange={setOpen}
      aria-label={ariaLabel}
      className={cn('w-full', className)}
    />
  )
}

// 24h times at 30-minute steps.
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? '00' : '30'
  return `${String(hour).padStart(2, '0')}:${minute}`
})

export function TimeControl({ value, onChange, ariaLabel }: { value: string; onChange(next: string): void; ariaLabel: string }) {
  const [open, setOpen] = React.useState(false)
  useCloseOnEditorScroll(setOpen)
  // Keep an off-grid value (e.g. an imported 22:15) selectable.
  const options = value && !TIME_OPTIONS.includes(value) ? [value, ...TIME_OPTIONS] : TIME_OPTIONS
  return (
    <Select value={value} onValueChange={onChange} open={open} onOpenChange={setOpen}>
      <SelectTrigger aria-label={ariaLabel} className="h-9 w-32 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {options.map((time) => (
          <SelectItem key={time} value={time}>{time}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PersonChip({
  name,
  badge,
  compact,
  onRemove,
  removeLabel,
}: {
  name: string
  badge?: React.ReactNode
  compact?: boolean
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted pl-1 pr-2',
        compact ? 'py-0.5' : 'py-1',
      )}
    >
      <Avatar size="xs" label={name} />
      <span className="max-w-40 truncate text-xs font-medium text-foreground">{name}</span>
      {badge}
      {onRemove ? (
        <IconButton
          variant="ghost"
          size="xs"
          onClick={(event) => { event.stopPropagation(); onRemove() }}
          aria-label={removeLabel}
          className="size-5 shrink-0"
        >
          <Plus aria-hidden className="size-3.5 rotate-45 opacity-50" />
        </IconButton>
      ) : null}
    </span>
  )
}
