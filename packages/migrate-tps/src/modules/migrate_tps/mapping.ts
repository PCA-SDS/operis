import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OptionGroup, Option, Price, ServiceItem } from './data/types'

/**
 * Locales carried by the legacy TPS export. This is a property of the source
 * data in `data/locales/`, not of the application's UI locale list, so it is
 * deliberately not derived from `@open-mercato/shared/lib/i18n/config`.
 */
const TPS_LOCALES = ['en', 'fr', 'vi', 'zh'] as const
type TpsLocale = (typeof TPS_LOCALES)[number]

/** A TPS locale file: nested groups of dot-addressable string entries. */
type TpsLocaleDictionary = { [key: string]: string | TpsLocaleDictionary }

const localesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './data/locales')

/**
 * Read with `fs` rather than `import ... with { type: 'json' }`: these commands
 * run under plain Node through `packages/cli/dist/bin.js`, where an ESM JSON
 * import without an import attribute throws `ERR_IMPORT_ATTRIBUTE_MISSING`.
 *
 * Loaded lazily and memoized so importing this module for its pure helpers
 * (`slugifyTpsText`, `parseTpsPrice`, …) costs no file I/O.
 */
let localesData: Record<TpsLocale, TpsLocaleDictionary> | null = null

function loadTpsLocales(): Record<TpsLocale, TpsLocaleDictionary> {
  if (localesData) return localesData
  const loaded = {} as Record<TpsLocale, TpsLocaleDictionary>
  for (const locale of TPS_LOCALES) {
    const filePath = path.join(localesDir, `${locale}.json`)
    try {
      loaded[locale] = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TpsLocaleDictionary
    } catch (err) {
      // Never degrade to "no translations": the migration would report success
      // while silently dropping every localized name, and the loss only shows
      // up once someone switches locale in the storefront.
      throw new Error(
        `[internal] migrate_tps: failed to read TPS locale file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  localesData = loaded
  return localesData
}

export function slugifyTpsText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

function priceMax(p: Price): number {
  if (typeof p === 'number') return p
  if (p.kind === 'range') return p.max
  return p.men !== undefined ? p.men : p.women
}

function priceMin(p: Price): number {
  if (typeof p === 'number') return p
  if (p.kind === 'range') return p.min
  return p.women
}

export function sumTpsPrices(p1: Price | undefined, p2: Price | undefined): Price | undefined {
  if (!p1) return p2
  if (!p2) return p1

  const min = priceMin(p1) + priceMin(p2)
  const max = priceMax(p1) + priceMax(p2)
  const isRange = (typeof p1 === 'object' && p1.kind === 'range') || (typeof p2 === 'object' && p2.kind === 'range')

  if (isRange) {
    return { kind: 'range', min, max }
  }
  return min
}

export function parseTpsPrice(price: Price | undefined): { unitPriceGross: string | null; priceMin: string | null; priceMax: string | null; metadata: Record<string, unknown> | null } {
  if (price === undefined || price === null) {
    return { unitPriceGross: null, priceMin: null, priceMax: null, metadata: null }
  }
  if (typeof price === 'number') {
    return { unitPriceGross: price.toString(), priceMin: null, priceMax: null, metadata: null }
  }
  if (typeof price === 'object') {
    if (price.kind === 'range') {
      return { unitPriceGross: null, priceMin: price.min.toString(), priceMax: price.max.toString(), metadata: price as unknown as Record<string, unknown> }
    }
    if (price.kind === 'gender') {
      return { unitPriceGross: price.women.toString(), priceMin: null, priceMax: null, metadata: price as unknown as Record<string, unknown> }
    }
  }
  return { unitPriceGross: null, priceMin: null, priceMax: null, metadata: null }
}

export function extractTpsDuration(item: Pick<ServiceItem, 'duration' | 'name' | 'description'> | Pick<Option, 'duration' | 'name' | 'description'>): string | undefined {
  if (item.duration) return item.duration
  
  const regex = /(\d+(?:\s*[-–]\s*\d+)?)\s*(?:mins|min|m)\b/i
  
  if (item.name) {
    const match = item.name.match(regex)
    if (match) return `${match[1].replace('–', '-')} mins`
  }
  if (item.description) {
    const match = item.description.match(regex)
    if (match) return `${match[1].replace('–', '-')} mins`
  }
  return undefined
}

export function parseTpsDurationForEntity(durationString: string | undefined): {
  durationMin?: number;
  durationMax?: number;
  durationValue?: number;
  durationUnit?: string;
} {
  if (!durationString) return {}
  const match = durationString.match(/(\d+)(?:\s*[-–]\s*(\d+))?/)
  if (!match) return {}

  const min = parseInt(match[1], 10)
  const max = match[2] ? parseInt(match[2], 10) : undefined

  return {
    durationUnit: 'minute',
    durationMin: max ? min : undefined,
    durationMax: max ? max : undefined,
    durationValue: max ? undefined : min
  }
}


export function hasNestedTpsOptionTree(groups: OptionGroup[]): boolean {
  return groups.some(g => g.options?.some(o => o.nextGroups && o.nextGroups.length > 0))
}

export function collectTpsSchemaGroups(groups: OptionGroup[], schemaGroups: Map<string, Set<string>>) {
  for (const group of groups) {
    if (!schemaGroups.has(group.label)) {
      schemaGroups.set(group.label, new Set())
    }
    const optionSet = schemaGroups.get(group.label)!
    for (const opt of group.options) {
      optionSet.add(opt.name)
      if (opt.nextGroups && opt.nextGroups.length > 0) {
        collectTpsSchemaGroups(opt.nextGroups, schemaGroups)
      }
    }
  }
}

export type OptionPath = {
  optionValues: Record<string, string>
  totalPrice: Price | undefined
  names: string[]
  durations: string[]
}

export function enumerateTpsOptionPaths(groups: OptionGroup[], currentPath: OptionPath): OptionPath[] {
  if (!groups || groups.length === 0) {
    return [currentPath]
  }

  let paths: OptionPath[] = [currentPath]

  for (const group of groups) {
    const nextPaths: OptionPath[] = []
    for (const path of paths) {
      for (const opt of group.options) {
        const newDurations = [...path.durations]
        const optDuration = extractTpsDuration(opt)
        if (optDuration) newDurations.push(optDuration)

        const newPath: OptionPath = {
          optionValues: { ...path.optionValues, [group.label]: opt.name },
          totalPrice: sumTpsPrices(path.totalPrice, opt.price),
          names: [...path.names, opt.name],
          durations: newDurations,
        }

        if (opt.nextGroups && opt.nextGroups.length > 0) {
          nextPaths.push(...enumerateTpsOptionPaths(opt.nextGroups, newPath))
        } else {
          nextPaths.push(newPath)
        }
      }
    }
    paths = nextPaths
  }

  return paths
}

function resolveKeyPath(dictionary: TpsLocaleDictionary, keyPath: string): string | undefined {
  let current: string | TpsLocaleDictionary | undefined = dictionary
  for (const segment of keyPath.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = current[segment]
  }
  return typeof current === 'string' ? current : undefined
}

/**
 * Build an `entity_translations.translations` payload from TPS locale keys.
 *
 * `fieldKeys` maps a target entity column (`name`, `description`, …) to the key
 * path in the TPS locale files. Locales resolving no field at all are omitted,
 * so an entity with no localized copy produces `{}` and the caller can skip
 * writing a translation row entirely.
 */
export function buildTranslationsPayload(
  fieldKeys: Record<string, string | undefined>,
): Record<string, Record<string, string>> {
  const translations: Record<string, Record<string, string>> = {}

  for (const [locale, dictionary] of Object.entries(loadTpsLocales())) {
    const localeContent: Record<string, string> = {}
    for (const [field, keyPath] of Object.entries(fieldKeys)) {
      if (!keyPath) continue
      const value = resolveKeyPath(dictionary, keyPath)
      if (value) localeContent[field] = value
    }
    if (Object.keys(localeContent).length > 0) translations[locale] = localeContent
  }

  return translations
}
