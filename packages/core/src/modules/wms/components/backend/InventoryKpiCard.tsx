"use client"

import Link from 'next/link'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

export type InventoryKpiCardProps = {
  title: string
  caption: string
  value: string
  badgeLabel: string | null
  badgeVariant: StatusBadgeVariant
  ctaLabel: string
  ctaHref?: string
  onCtaClick?: () => void
}

export function InventoryKpiCard({
  title,
  caption,
  value,
  badgeLabel,
  badgeVariant,
  ctaLabel,
  ctaHref,
  onCtaClick,
}: InventoryKpiCardProps) {
  return (
    <section className="flex min-h-52 flex-col rounded-xl border border-card-edge bg-surface shadow-sm p-5 text-card-foreground">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-3 text-xs text-muted-foreground">{caption}</p>
      </div>
      <div className="mt-auto pt-2">
        <div className="flex items-end gap-3">
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
          {badgeLabel ? (
            <StatusBadge variant={badgeVariant} dot>
              {badgeLabel}
            </StatusBadge>
          ) : null}
        </div>
        {onCtaClick ? (
          <LinkButton variant="primary" size="sm" className="mt-4 w-fit" onClick={onCtaClick}>
            {ctaLabel}
          </LinkButton>
        ) : ctaHref ? (
          <LinkButton asChild variant="primary" size="sm" className="mt-4 w-fit">
            <Link href={ctaHref}>{ctaLabel}</Link>
          </LinkButton>
        ) : null}
      </div>
    </section>
  )
}
