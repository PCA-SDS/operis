"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

export type SelectionIndicatorProps = {
  checked: boolean
  disabled?: boolean
  /**
   * Accessible name — and the switch between the component's two roles.
   *
   * Pass it when this mark IS the control, as in a row that is a plain `div`:
   * the indicator then carries `role="checkbox"` and its own checked state.
   *
   * Omit it when the row around it is already a `<button role="checkbox">`. The
   * indicator is then marked `aria-hidden`, because a second checkbox role
   * inside the first would announce the option twice and give a screen reader
   * two conflicting states for one choice.
   */
  label?: string
  className?: string
}

/**
 * The round selected/not-selected mark used by every multi-select list in the
 * product — the entity linker, the chat member picker.
 *
 * A ring on the trailing edge rather than a leading checkbox: in a list of
 * people or records the identity should start the row, and a column of square
 * boxes down the left turns a roster into a form. Filled with the primary when
 * chosen, so "selected" survives being read at a glance.
 */
export function SelectionIndicator({ checked, disabled, label, className }: SelectionIndicatorProps) {
  const semantics = label
    ? { role: 'checkbox' as const, 'aria-checked': checked, 'aria-label': label }
    : { 'aria-hidden': true as const }

  return (
    <span
      {...semantics}
      aria-disabled={label && disabled ? true : undefined}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface',
        disabled && 'opacity-50',
        className,
      )}
    >
      {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
    </span>
  )
}
