"use client"

import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { TASK_STATUSES, type TaskStatus } from '../data/types'
import { StatusIcon } from './StatusIcon'
import { TASK_STATUS_META } from './format'

type StatusSelectVariant = 'button' | 'chip' | 'icon'

/**
 * Status picker. The `icon` variant is the one that sits on every list row —
 * the glyph alone, so a dense list stays scannable and the whole row is not
 * dominated by seven repeated words.
 */
export function StatusSelect({
  value,
  onChange,
  variant = 'button',
  dense = false,
  disabled,
}: {
  value: TaskStatus
  onChange: (next: TaskStatus) => void
  variant?: StatusSelectVariant
  dense?: boolean
  disabled?: boolean
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const meta = TASK_STATUS_META[value]
  const label = t(meta.labelKey, meta.fallback)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={(event) => event.stopPropagation()}
          title={t('tasks.status.label', 'Status: {status}', { status: label })}
          className={cn(
            'transition-colors focus:outline-none focus-visible:shadow-focus disabled:opacity-60',
            variant === 'icon' &&
              'inline-flex items-center justify-center rounded p-1 hover:bg-surface-strong',
            variant === 'chip' &&
              cn('inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium', meta.bgClass, meta.textClass),
            variant === 'button' &&
              cn(
                'inline-flex items-center gap-2 rounded-md text-sm font-semibold',
                dense ? 'h-8 px-2.5' : 'h-9 px-3',
                meta.bgClass,
                meta.textClass,
              ),
          )}
        >
          {variant === 'icon' ? (
            <StatusIcon status={value} />
          ) : (
            <>
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: meta.colorVar }}
              />
              {label}
              {!disabled && <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-52 p-2"
        role="listbox"
        aria-label={t('tasks.status.select', 'Task status')}
        onClick={(event) => event.stopPropagation()}
      >
        {TASK_STATUSES.map((status) => {
          const optionMeta = TASK_STATUS_META[status]
          const active = status === value
          return (
            <button
              key={status}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => {
                onChange(status)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-muted',
                active && 'bg-surface-muted',
              )}
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ backgroundColor: optionMeta.colorVar }}
              />
              <span className="flex-1 truncate">{t(optionMeta.labelKey, optionMeta.fallback)}</span>
              {active && <Check className="size-3.5 shrink-0 text-accent-strong" aria-hidden="true" />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
