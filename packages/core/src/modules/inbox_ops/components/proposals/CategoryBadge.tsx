'use client'

import React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  FileQuestion,
  ShoppingCart,
  RefreshCw,
  AlertTriangle,
  Truck,
  HelpCircle,
  CreditCard,
  Tag,
} from 'lucide-react'
import { ALL_CATEGORIES } from '../../data/validators'

export { ALL_CATEGORIES }

export const CATEGORY_CONFIG: Record<string, { color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  rfq: { color: 'bg-status-info-bg text-status-info-text', Icon: FileQuestion },
  order: { color: 'bg-status-success-bg text-status-success-text', Icon: ShoppingCart },
  order_update: { color: 'bg-status-warning-bg text-status-warning-text', Icon: RefreshCw },
  complaint: { color: 'bg-status-error-bg text-status-error-text', Icon: AlertTriangle },
  shipping_update: { color: 'bg-status-pink-bg text-status-pink-text', Icon: Truck },
  inquiry: { color: 'bg-surface-muted text-foreground', Icon: HelpCircle },
  payment: { color: 'bg-status-success-bg text-status-success-text', Icon: CreditCard },
  other: { color: 'bg-surface-muted text-foreground', Icon: Tag },
}

export function useCategoryLabels() {
  const t = useT()
  return React.useMemo<Record<string, string>>(() => ({
    rfq: t('inbox_ops.category.rfq', 'RFQ'),
    order: t('inbox_ops.category.order', 'Order'),
    order_update: t('inbox_ops.category.order_update', 'Order Update'),
    complaint: t('inbox_ops.category.complaint', 'Complaint'),
    shipping_update: t('inbox_ops.category.shipping_update', 'Shipping Update'),
    inquiry: t('inbox_ops.category.inquiry', 'Inquiry'),
    payment: t('inbox_ops.category.payment', 'Payment'),
    other: t('inbox_ops.category.other', 'Other'),
  }), [t])
}

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  const labels = useCategoryLabels()
  const t = useT()
  if (!category) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-muted text-muted-foreground">{t('inbox_ops.category.uncategorized', 'Uncategorized')}</span>
  }
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.other
  const { color, Icon } = config
  const label = labels[category] || category
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
