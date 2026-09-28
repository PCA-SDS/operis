/** A page of rows from a WMS list endpoint. */
export type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

export type WarehouseOption = {
  id: string
  name?: string | null
  code?: string | null
}

/** A row of the inventory balances list: the detail pages and the inventory console each read part of it. */
export type InventoryBalanceRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  location_id?: string | null
  location_code?: string | null
  location_type?: string | null
  catalog_variant_id?: string | null
  variant_name?: string | null
  variant_sku?: string | null
  lot_id?: string | null
  quantity_on_hand?: string | number | null
  quantity_reserved?: string | number | null
  quantity_allocated?: string | number | null
  quantity_available?: number | null
}

/** A row of the inventory movements list: the detail pages and the inventory console each read part of it. */
export type InventoryMovementRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  location_from_id?: string | null
  location_from_code?: string | null
  location_from_type?: string | null
  location_to_id?: string | null
  location_to_code?: string | null
  location_to_type?: string | null
  catalog_variant_id?: string | null
  variant_sku?: string | null
  variant_name?: string | null
  lot_id?: string | null
  quantity?: string | number | null
  type?: string | null
  reference_type?: string | null
  reference_id?: string | null
  reason?: string | null
  reason_code?: string | null
  performed_at?: string | null
  received_at?: string | null
}
