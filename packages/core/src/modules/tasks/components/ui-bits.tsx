"use client"

import * as React from 'react'
import { Clock, Plus } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { TimePicker, formatTimePickerDisplay } from '@open-mercato/ui/primitives/time-picker'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

// The card vocabulary the whole module is built from. Cards sit on
// `modal-muted` (a raised plane a shade quieter than a dialog) with a shadow
// and no border — a border plus a shadow reads as two competing edges.
export const CARD_CLASS = 'overflow-hidden rounded-xl bg-modal-muted shadow-sm'
export const CARD_HEADER_CLASS =
  'flex items-center gap-2 border-b border-border bg-surface-muted px-3 py-2.5 sm:px-5'
export const CARD_CAPTION_CLASS =
  'text-overline font-bold uppercase tracking-widest text-muted-foreground'
export const CARD_ROW_CLASS = 'flex items-center gap-2.5 px-3 py-2.5 sm:px-5'

export function CountBadge({ value }: { value: number }) {
  return <span className="text-xs font-medium tabular-nums text-muted-foreground">{value}</span>
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text"
    >
      {children}
    </div>
  )
}

type AddTaskVariant = 'accent' | 'row' | 'compact'

const ADD_TASK_CLASS: Record<AddTaskVariant, string> = {
  accent:
    'group flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-sm text-muted-foreground transition-colors hover:text-primary focus:outline-none focus-visible:shadow-focus',
  row: 'flex w-full items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:shadow-focus sm:px-5',
  compact:
    'flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground focus:outline-none focus-visible:shadow-focus',
}

/** The quiet "＋ Add task" affordance that sits at the end of a list or column
 *  — a full button here would out-shout the tasks it is adding to. */
export function AddTaskRow({
  label,
  onClick,
  variant = 'row',
  indent = false,
}: {
  label: string
  onClick: () => void
  variant?: AddTaskVariant
  indent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(ADD_TASK_CLASS[variant], indent && variant === 'row' && 'pl-10 sm:pl-14')}
    >
      {variant === 'accent' ? (
        <span className="flex size-5 items-center justify-center rounded-full text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <Plus className="size-4" aria-hidden="true" />
        </span>
      ) : (
        <Plus className={variant === 'compact' ? 'size-4' : 'size-3.5'} aria-hidden="true" />
      )}
      {label}
    </button>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl bg-modal-muted px-5 py-5 shadow-sm sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Field({
  label,
  required,
  error,
  htmlFor,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs font-medium text-status-error-text">
          {error}
        </p>
      )}
    </div>
  )
}

const INPUT_CLASS =
  'w-full rounded-lg border border-input bg-input-bg px-3 py-2.5 text-sm text-foreground placeholder:text-disabled-foreground transition-colors focus:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-bg-disabled disabled:opacity-70'

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
  invalid,
  id,
  autoFocus,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  invalid?: boolean
  id?: string
  autoFocus?: boolean
  ariaLabel?: string
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      className={cn(INPUT_CLASS, invalid && 'border-destructive')}
    />
  )
}

export function TextArea({
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
  rows = 3,
  id,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  rows?: number
  id?: string
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      rows={rows}
      className={cn(INPUT_CLASS, 'resize-none')}
    />
  )
}

export type PickerVariant = 'form' | 'compact' | 'dense'

const PICKER_BASE: Record<PickerVariant, string> = {
  form: 'w-full',
  compact: 'h-9 w-full',
  dense: 'h-8 w-full',
}

/** The chrome the DS `DatePicker` puts on its own trigger. `TimeInput` has to
 *  restate it because the time picker leaves the trigger to its caller, and the
 *  two controls sit side by side in every due-date row. */
const PICKER_TRIGGER_CLASS =
  'inline-flex w-full items-center gap-2 rounded-md border border-input bg-input-bg text-left shadow-xs transition-colors hover:bg-muted/40 focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-bg-disabled disabled:shadow-none disabled:hover:bg-bg-disabled'

const PICKER_TRIGGER_SIZE: Record<PickerVariant, string> = {
  form: 'h-9 px-3 text-sm',
  compact: 'h-9 px-2.5 text-xs',
  dense: 'h-8 px-2.5 text-xs',
}

/** Date input over the DS `DatePicker`, speaking the module's `YYYY-MM-DD`
 *  strings instead of `Date` objects so a due date never picks up a timezone. */
export function DateInput({
  value,
  onChange,
  disabled,
  invalid,
  id,
  ariaLabel,
  placeholder,
  variant = 'form',
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  invalid?: boolean
  id?: string
  ariaLabel?: string
  placeholder?: string
  variant?: PickerVariant
}) {
  const parsed = value ? new Date(`${value}T00:00:00.000Z`) : null
  return (
    <DatePicker
      id={id}
      value={parsed && !Number.isNaN(parsed.getTime()) ? parsed : null}
      onChange={(next) => onChange(next ? isoDayOf(next) : '')}
      disabled={disabled}
      size={variant === 'form' ? 'default' : 'sm'}
      footer="today-clear"
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(PICKER_BASE[variant], invalid && 'border-destructive text-destructive')}
    />
  )
}

/** The DatePicker hands back a local `Date`; a due date is a calendar day, so
 *  read the local Y/M/D rather than the UTC ones. */
function isoDayOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Time input over the DS `TimePicker`. The primitive only anchors itself in a
 *  popover when it is handed a `trigger` — without one it renders its 320px slot
 *  card straight into the layout, where the row's height clamps it to a sliver.
 *  The trigger also portals the card out of the composer's scroll container, so
 *  no ancestor's `overflow` can crop it. */
export function TimeInput({
  value,
  onChange,
  disabled,
  ariaLabel,
  placeholder,
  variant = 'form',
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  ariaLabel?: string
  placeholder?: string
  variant?: PickerVariant
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const placeholderText = placeholder ?? t('tasks.panel.noDueTime', 'No time')
  const display = value ? formatTimePickerDisplay(value, '12h') : null
  const label = display ? [display.main, display.suffix].filter(Boolean).join(' ') : placeholderText

  return (
    <TimePicker
      value={value || null}
      // Picking a slot is the entire interaction, and the card runs without a
      // footer — so the choice commits and dismisses in one click.
      onChange={(next) => {
        onChange(next ?? '')
        setOpen(false)
      }}
      disabled={disabled}
      showHeader={false}
      showFooter={false}
      intervalMinutes={30}
      headerPlaceholder={placeholderText}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-label={ariaLabel}
          className={cn(
            PICKER_TRIGGER_CLASS,
            PICKER_TRIGGER_SIZE[variant],
            !value && 'text-muted-foreground',
          )}
        >
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 truncate">{label}</span>
        </button>
      }
    />
  )
}

const TITLE_SIZE = {
  lg: 'text-xl',
  xl: 'text-2xl',
} as const

/**
 * Auto-growing single-line title field. `onCommit` turns it into an
 * edit-in-place control: Enter or blur saves, and a blur with no real change
 * quietly restores rather than firing a no-op write.
 */
export function TitleInput({
  value,
  onChange,
  onCommit,
  placeholder,
  autoFocus,
  minHeightClass,
  size = 'xl',
  ariaLabel,
}: {
  value: string
  onChange?: (next: string) => void
  onCommit?: (next: string) => void
  placeholder?: string
  autoFocus?: boolean
  minHeightClass?: string
  size?: keyof typeof TITLE_SIZE
  ariaLabel?: string
}) {
  const [text, setText] = React.useState(value)
  const ref = React.useRef<HTMLTextAreaElement | null>(null)
  const focused = React.useRef(false)

  React.useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [text])

  return (
    <textarea
      ref={ref}
      rows={1}
      autoFocus={autoFocus}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={() => {
        focused.current = true
      }}
      onChange={(event) => {
        setText(event.target.value)
        onChange?.(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      onBlur={() => {
        focused.current = false
        const trimmed = text.trim()
        if (!onCommit) return
        if (trimmed && trimmed !== value.trim()) onCommit(trimmed)
        else setText(value)
      }}
      className={cn(
        'w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-semibold leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none',
        TITLE_SIZE[size],
        minHeightClass,
      )}
    />
  )
}

export type TabDef<T extends string> = {
  value: T
  label: string
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

/**
 * The module's tab strip. Reserves the bold width up front (an invisible bold
 * copy under the visible label) so switching tabs never nudges its neighbours.
 */
export function TasksTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: readonly TabDef<T>[]
  value: T
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex items-center overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              'group relative flex shrink-0 items-center gap-2 px-4 py-3 text-sm transition-colors focus:outline-none focus-visible:shadow-focus',
              active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            <span className="grid">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-semibold">
                {tab.label}
              </span>
              <span
                className={cn(
                  'col-start-1 row-start-1 transition-[font-weight,color] group-hover:font-semibold group-hover:text-foreground',
                  active ? 'font-semibold' : 'font-medium',
                )}
              >
                {tab.label}
              </span>
            </span>
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-0.5 bg-accent-strong"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return <Progress value={Math.max(0, Math.min(100, value))} size="sm" tone="accent" label={label} />
}

export function UserAvatar({ name, size = 'sm' }: { name: string | null; size?: 'sm' | 'xs' }) {
  if (!name) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-dashed border-border text-disabled-foreground',
          size === 'xs' ? 'size-5 text-overline' : 'size-6 text-xs',
        )}
      >
        ?
      </span>
    )
  }
  return <Avatar label={name} size={size === 'xs' ? 'xs' : 'sm'} title={name} />
}

export function ErrorState({
  message,
  onRetry,
  size = 'default',
}: {
  message: string
  onRetry?: () => void
  size?: 'sm' | 'default' | 'lg'
}) {
  const t = useT()
  return (
    <EmptyState
      variant="subtle"
      size={size}
      title={t('tasks.common.loadFailed', "This didn't load")}
      description={message}
      actions={
        onRetry ? (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {t('tasks.common.retry', 'Try again')}
          </Button>
        ) : undefined
      }
    />
  )
}

export function SkeletonBlock({ className = 'h-64' }: { className?: string }) {
  return <Skeleton className={cn('rounded-xl', className)} />
}
