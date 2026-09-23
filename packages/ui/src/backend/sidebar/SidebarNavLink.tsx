'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  SIDEBAR_ICON_BOX,
  SIDEBAR_ITEM_BASE,
  SIDEBAR_ITEM_LABEL,
  SIDEBAR_RAIL_CONTENT,
  SIDEBAR_RAIL_TRANSITION,
  sidebarItemStateClass,
  sidebarRailFadeClass,
} from './chrome'

/* A row pads 12px, and each level of depth steps in another 12px. Collapsed,
 * every depth returns to the first step so child icons join the one icon column
 * instead of hanging off the edge of the 44px pill. */
const ROW_INSET_PX = 12
const DEPTH_STEP_PX = 12

export type SidebarNavLinkProps = Omit<
  React.ComponentPropsWithoutRef<typeof Link>,
  'href' | 'className' | 'style' | 'children'
> & {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
  depth?: number
  disabled?: boolean
  labelClassName?: string
  /** Set only by the collapsible desktop rail; `undefined` renders a plain row. */
  railCollapsed?: boolean
}

export function SidebarNavLink({
  href,
  label,
  icon,
  active,
  depth = 0,
  disabled = false,
  labelClassName = '',
  railCollapsed,
  ...linkProps
}: SidebarNavLinkProps) {
  const inset = railCollapsed ? ROW_INSET_PX : ROW_INSET_PX + depth * DEPTH_STEP_PX
  return (
    <Link
      href={href}
      className={`${SIDEBAR_ITEM_BASE} ${depth === 0 ? 'h-10' : 'h-9'} w-full overflow-hidden ${sidebarItemStateClass(active)} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      aria-disabled={disabled || undefined}
      {...linkProps}
    >
      <span
        className={`flex h-full items-center gap-3 pr-3 transition-[padding] ${SIDEBAR_RAIL_TRANSITION} ${SIDEBAR_RAIL_CONTENT}`}
        style={{ paddingLeft: inset }}
      >
        <span className={SIDEBAR_ICON_BOX}>{icon}</span>
        <span className={`${SIDEBAR_ITEM_LABEL} ${labelClassName} ${sidebarRailFadeClass(railCollapsed)}`}>{label}</span>
      </span>
    </Link>
  )
}
