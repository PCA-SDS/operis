import { toFiniteNumber } from '@open-mercato/shared/lib/number'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { InventoryBalanceRow } from './inventoryTypes'

export const NEAR_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

export function isNearExpiry(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return false
  return expires > nowMs && expires - nowMs <= NEAR_EXPIRY_MS
}

export function isExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false
  const expires = new Date(expiresAt).getTime()
  return !Number.isNaN(expires) && expires <= nowMs
}

export function formatWarehouseLabel(row: {
  warehouse_name?: string | null
  warehouse_code?: string | null
  warehouse_id?: string | null
}): string {
  const code = (row.warehouse_code ?? '').trim()
  const name = (row.warehouse_name ?? '').trim()
  if (code && name) return `${code} · ${name}`
  return name || code || row.warehouse_id || '—'
}

export function formatLocationLabel(code: string | null | undefined, id: string | null | undefined): string {
  const trimmed = (code ?? '').trim()
  if (trimmed) return trimmed
  return id || '—'
}

export type InventoryLotRow = {
  id: string
  lot_number?: string | null
  expires_at?: string | null
  status?: string | null
}

export function formatLotLabel(
  lot: InventoryLotRow | undefined,
  locale: string,
): string {
  if (!lot) return '—'
  const number = (lot.lot_number ?? '').trim() || lot.id
  if (!lot.expires_at) return number
  const expires = new Date(lot.expires_at)
  if (Number.isNaN(expires.getTime())) return number
  const expLabel = new Intl.DateTimeFormat(locale, { month: '2-digit', year: '2-digit' }).format(expires)
  return `${number} · exp ${expLabel}`
}

export type DistributionFilter = 'all' | 'sellable' | 'picking' | 'nearExpiry'

export const NON_SELLABLE_LOCATION_TYPES = new Set(['staging', 'dock'])
export const PICKING_LOCATION_TYPES = new Set(['staging', 'bin', 'slot'])

const BALANCE_STATUS_LABEL_KEYS = {
  lot: {
    expired: 'wms.backend.lot.distribution.status.expired',
    nearExpiry: 'wms.backend.lot.distribution.status.nearExpiry',
    lowStock: 'wms.backend.lot.distribution.status.lowStock',
    reserved: 'wms.backend.lot.distribution.status.reserved',
    available: 'wms.backend.lot.distribution.status.available',
  },
  sku: {
    expired: 'wms.backend.sku.distribution.status.expired',
    nearExpiry: 'wms.backend.sku.distribution.status.nearExpiry',
    lowStock: 'wms.backend.sku.distribution.status.lowStock',
    reserved: 'wms.backend.sku.distribution.status.reserved',
    available: 'wms.backend.sku.distribution.status.available',
  },
} as const

/** A balance row's status badge on the lot and SKU pages; each page keeps its own translation keys. */
export function resolveBalanceStatus(
  row: InventoryBalanceRow,
  lot: InventoryLotRow | null | undefined,
  reorderPoint: number,
  nowMs: number,
  scope: 'lot' | 'sku',
): { variant: StatusBadgeVariant; labelKey: string; labelFallback: string } {
  if (lot?.status === 'expired' || isExpired(lot?.expires_at, nowMs)) {
    return {
      variant: 'error',
      labelKey: BALANCE_STATUS_LABEL_KEYS[scope].expired,
      labelFallback: 'Expired',
    }
  }
  if (isNearExpiry(lot?.expires_at, nowMs)) {
    return {
      variant: 'warning',
      labelKey: BALANCE_STATUS_LABEL_KEYS[scope].nearExpiry,
      labelFallback: 'Near expiry',
    }
  }
  const available = row.quantity_available ?? 0
  if (reorderPoint > 0 && available <= reorderPoint) {
    return {
      variant: 'warning',
      labelKey: BALANCE_STATUS_LABEL_KEYS[scope].lowStock,
      labelFallback: 'Low stock',
    }
  }
  const reserved = toFiniteNumber(row.quantity_reserved)
  const onHand = toFiniteNumber(row.quantity_on_hand)
  if (reserved > 0 && onHand > 0 && reserved >= onHand) {
    return {
      variant: 'info',
      labelKey: BALANCE_STATUS_LABEL_KEYS[scope].reserved,
      labelFallback: 'Reserved',
    }
  }
  return {
    variant: 'success',
    labelKey: BALANCE_STATUS_LABEL_KEYS[scope].available,
    labelFallback: 'Available',
  }
}
