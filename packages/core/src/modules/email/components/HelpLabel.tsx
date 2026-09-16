"use client"

import * as React from 'react'
import { Info } from 'lucide-react'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'

/**
 * A field label with an inline help affordance.
 *
 * Three byte-identical copies of this lived in the templates form, the compose
 * page and the accounting-defaults page, each hand-rolling a `group-hover`
 * popover painted with `bg-background` — the page ground, not a raised plane,
 * and sized with an arbitrary `text-[10px]`. It is one component now, on the
 * design system's tooltip, which also gives it focus and touch behaviour the
 * hover-only version never had.
 */
export function HelpLabel({ children, help }: { children: React.ReactNode; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{children}</span>
      <SimpleTooltip content={help} variant="light" side="top">
        <button
          type="button"
          aria-label={help}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </SimpleTooltip>
    </span>
  )
}
