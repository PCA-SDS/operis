"use client"

import { toNumber } from '../../lib/numbers'

export type LineDiscountDisplay = {
  amount: number | null
  percent: number | null
}

type LineDiscountSource = {
  discountAmount?: unknown
  discountPercent?: unknown
  unitPriceNet?: unknown
  quantity?: unknown
}

const DISCOUNT_MATCH_TOLERANCE = 0.01
const DISCOUNT_MATCH_TOLERANCE_PER_UNIT = 0.0001

function percentAccountsForAmount(
  line: LineDiscountSource,
  percent: number,
  amount: number,
): boolean {
  if (percent <= 0) return false
  const quantity = toNumber(line.quantity, 0)
  const netBeforeDiscount = toNumber(line.unitPriceNet, 0) * quantity
  if (netBeforeDiscount <= 0) return false
  const tolerance = Math.max(
    DISCOUNT_MATCH_TOLERANCE,
    quantity * DISCOUNT_MATCH_TOLERANCE_PER_UNIT,
  )
  return Math.abs((percent / 100) * netBeforeDiscount - amount) <= tolerance
}

export function resolveLineDiscountDisplay(
  line: LineDiscountSource,
): LineDiscountDisplay | null {
  const amount = toNumber(line.discountAmount, 0)
  const percent = toNumber(line.discountPercent, 0)
  if (amount > 0) {
    return {
      amount,
      percent: percentAccountsForAmount(line, percent, amount) ? percent : null,
    }
  }
  if (percent > 0) return { amount: null, percent }
  return null
}
