import type { useT } from '@open-mercato/shared/lib/i18n/context'
import { toFiniteNumber } from '@open-mercato/shared/lib/number'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import {
  inventoryMovementReasonLabel,
  type InventoryDisplayTranslator,
} from '../../lib/inventoryDisplayUi'
import { formatLocationLabel, formatWarehouseLabel } from './inventoryDetailFormat'
import type { InventoryMovementRow } from './inventoryTypes'

/** Movement type labels; each detail page keeps its own translation keys (`wms.backend.<scope>.activity.types.*`). */
export function movementTypeLabel(
  type: string,
  t: ReturnType<typeof useT>,
  scope: 'lot' | 'sku' | 'location',
): string {
  const key = `wms.backend.${scope}.activity.types.${type}`
  const fallbacks: Record<string, string> = {
    receipt: 'Receive',
    return_receive: 'Receive',
    adjust: 'Adjust',
    transfer: 'Move',
    pick: 'Allocate',
    pack: 'Allocate',
    cycle_count: 'Reconcile',
    putaway: 'Putaway',
    ship: 'Ship',
  }
  return t(key, fallbacks[type] ?? type)
}

export const movementStatusMap: Record<string, StatusBadgeVariant> = {
  receipt: 'success',
  return_receive: 'success',
  adjust: 'warning',
  transfer: 'info',
  pick: 'info',
  pack: 'info',
  cycle_count: 'neutral',
  putaway: 'info',
  ship: 'success',
}

/** The SKU and location pages' movement title, on the dashboard's activity keys. */
export function formatMovementTitle(
  row: InventoryMovementRow,
  skuLabel: string,
  t: ReturnType<typeof useT>,
): string {
  const quantity = Math.abs(toFiniteNumber(row.quantity))
  const signedQuantity = toFiniteNumber(row.quantity)
  switch (row.type) {
    case 'receipt':
    case 'return_receive':
      return t('wms.backend.dashboard.activity.titles.received', 'Received {quantity}× {sku}', {
        quantity,
        sku: skuLabel,
      })
    case 'adjust':
      return t('wms.backend.dashboard.activity.titles.adjusted', 'Adjusted {quantity}× {sku}', {
        quantity: `${signedQuantity >= 0 ? '+' : ''}${signedQuantity}`,
        sku: skuLabel,
      })
    case 'transfer':
      return t('wms.backend.dashboard.activity.titles.moved', 'Moved {quantity}× {sku}', {
        quantity,
        sku: skuLabel,
      })
    case 'pick':
    case 'pack':
      return t('wms.backend.dashboard.activity.titles.allocated', 'Allocated {quantity}× {sku}', {
        quantity,
        sku: skuLabel,
      })
    case 'cycle_count':
      return t('wms.backend.dashboard.activity.titles.reconciled', 'Inventory reconciled — {sku}', {
        sku: skuLabel,
      })
    default:
      return t('wms.backend.dashboard.activity.titles.generic', '{type} {quantity}× {sku}', {
        type: row.type ?? 'movement',
        quantity,
        sku: skuLabel,
      })
  }
}

export function formatMovementSubtitle(
  row: InventoryMovementRow,
  t: InventoryDisplayTranslator,
): string | null {
  const reasonLabel = inventoryMovementReasonLabel(
    {
      reasonCode: row.reason_code,
      reason: row.reason,
      movementType: row.type,
    },
    t,
  )
  if (reasonLabel) return reasonLabel
  if (row.reference_type && row.reference_id) return `${row.reference_type} · ${row.reference_id}`
  return null
}

/** Where a movement happened, by warehouse and location (the lot and SKU pages). */
export function formatMovementLocation(row: InventoryMovementRow): string {
  const warehouse = formatWarehouseLabel(row)
  const from = formatLocationLabel(row.location_from_code, row.location_from_id)
  const to = formatLocationLabel(row.location_to_code, row.location_to_id)
  if (row.type === 'transfer' && from !== '—' && to !== '—') return `${from} → ${to}`
  const location = to !== '—' ? to : from
  if (location !== '—') return `${warehouse} · ${location}`
  return warehouse
}
