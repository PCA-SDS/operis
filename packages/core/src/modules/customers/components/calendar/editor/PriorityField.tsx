"use client"

import * as React from 'react'
import { ChevronsDown, ChevronsUp, Equal } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { EditorPriority } from '../../../lib/calendar/editorPayload'
import { useCloseOnEditorScroll } from './inputs'

// Jira/Linear-style priority glyphs: filled double chevrons for the extremes,
// an equals bar for the middle. Colours stay on DS status tokens (no amber):
// blue = low urgency, muted = medium, red = high.
const PRIORITY_META: Record<EditorPriority, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  low: { Icon: ChevronsDown, color: 'text-status-info-text' },
  medium: { Icon: Equal, color: 'text-muted-foreground' },
  high: { Icon: ChevronsUp, color: 'text-status-error-text' },
}

const PRIORITY_ORDER: EditorPriority[] = ['high', 'medium', 'low']

/**
 * A fixed three-value enum, so it is a `Select` rather than a combobox — there
 * is nothing to search. This used to be a hand-built listbox, which meant
 * re-implementing what Radix already gives us: typeahead, arrow-key roving,
 * the selected-item checkmark, and dismissal. The old version needed a
 * document-level pointerdown listener to close at all; `Select` portals to
 * `z-popover`, which is above the dialog, so none of that is needed.
 *
 * `SelectItem` puts its children inside Radix's `ItemText`, so the glyph shown
 * in the list is the same node echoed in the closed trigger — one definition,
 * not two.
 */
export function PriorityField({
  value,
  labels,
  ariaLabel,
  onChange,
}: {
  value: EditorPriority
  labels: Record<EditorPriority, string>
  ariaLabel: string
  onChange(next: EditorPriority): void
}) {
  const [open, setOpen] = React.useState(false)
  useCloseOnEditorScroll(setOpen)

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as EditorPriority)}
      open={open}
      onOpenChange={setOpen}
    >
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITY_ORDER.map((priority) => {
          const { Icon, color } = PRIORITY_META[priority]
          return (
            <SelectItem key={priority} value={priority}>
              <Icon aria-hidden className={cn('size-4 shrink-0', color)} />
              <span className="min-w-0 truncate">{labels[priority]}</span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
