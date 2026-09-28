export function inferPriceKindCode(attributeCode: string): string {
  const normalized = attributeCode.trim().toLowerCase()
  return normalized.includes('sale')
    || normalized.includes('promo')
    || normalized.includes('special')
    || normalized.includes('discount')
    ? 'sale'
    : 'regular'
}

export function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
}
