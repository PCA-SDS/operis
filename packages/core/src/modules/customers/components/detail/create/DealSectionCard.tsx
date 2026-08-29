"use client"

import * as React from 'react'
import { FormSection } from '@open-mercato/ui/backend/forms/FormSection'

export type DealSectionCardProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * Thin wrapper kept for the deal-create call sites' prop shape. The chrome is
 * the shared `FormSection`, so a deal section is the same block as a CrudForm
 * group rather than a look of its own.
 */
export function DealSectionCard({
  icon,
  title,
  subtitle,
  actions,
  children,
  className,
}: DealSectionCardProps) {
  return (
    <FormSection
      icon={icon}
      title={title}
      description={subtitle}
      actions={actions}
      className={className}
    >
      {children}
    </FormSection>
  )
}
