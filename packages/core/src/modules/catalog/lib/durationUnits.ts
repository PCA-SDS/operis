export const CATALOG_DURATION_UNITS = ['minute', 'hour', 'day', 'month'] as const

export type CatalogDurationUnit = (typeof CATALOG_DURATION_UNITS)[number]

export const DEFAULT_CATALOG_DURATION_UNIT: CatalogDurationUnit = 'minute'

export const CATALOG_DURATION_UNIT_LABEL_KEYS: Record<CatalogDurationUnit, string> = {
  minute: 'catalog.variants.form.durationUnit.minute',
  hour: 'catalog.variants.form.durationUnit.hour',
  day: 'catalog.duration.day',
  month: 'catalog.duration.month',
}

export const CATALOG_DURATION_UNIT_SHORT_LABEL_KEYS: Record<CatalogDurationUnit, string> = {
  minute: 'catalog.options.durationUnitMinuteShort',
  hour: 'catalog.options.durationUnitHourShort',
  day: 'catalog.duration.dayShort',
  month: 'catalog.duration.monthShort',
}

export const CATALOG_DURATION_UNIT_LABEL_FALLBACKS: Record<CatalogDurationUnit, string> = {
  minute: 'Minutes',
  hour: 'Hours',
  day: 'Days',
  month: 'Months',
}

export const CATALOG_DURATION_UNIT_SHORT_LABEL_FALLBACKS: Record<CatalogDurationUnit, string> = {
  minute: 'min',
  hour: 'hr',
  day: 'd',
  month: 'mo',
}

export const CATALOG_DURATION_UNIT_OPTIONS = CATALOG_DURATION_UNITS.map((value) => ({
  value,
  labelKey: CATALOG_DURATION_UNIT_LABEL_KEYS[value],
  labelFallback: CATALOG_DURATION_UNIT_LABEL_FALLBACKS[value],
  shortLabelKey: CATALOG_DURATION_UNIT_SHORT_LABEL_KEYS[value],
  shortLabelFallback: CATALOG_DURATION_UNIT_SHORT_LABEL_FALLBACKS[value],
})) satisfies Array<{
  value: CatalogDurationUnit
  labelKey: string
  labelFallback: string
  shortLabelKey: string
  shortLabelFallback: string
}>

const DURATION_UNIT_ALIASES: Record<string, CatalogDurationUnit> = {
  m: 'minute',
  min: 'minute',
  mins: 'minute',
  minute: 'minute',
  minutes: 'minute',
  h: 'hour',
  hr: 'hour',
  hrs: 'hour',
  hour: 'hour',
  hours: 'hour',
  d: 'day',
  day: 'day',
  days: 'day',
  mo: 'month',
  mon: 'month',
  mons: 'month',
  month: 'month',
  months: 'month',
}

export function normalizeCatalogDurationUnit(
  value: unknown,
  fallback: CatalogDurationUnit | null = DEFAULT_CATALOG_DURATION_UNIT,
): CatalogDurationUnit | null {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (!normalized.length) return fallback
  return DURATION_UNIT_ALIASES[normalized] ?? fallback
}

export function isCatalogDurationUnit(value: unknown): value is CatalogDurationUnit {
  return normalizeCatalogDurationUnit(value, null) !== null
}
