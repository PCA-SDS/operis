import type { OptionGroup, Option, Price, ServiceItem } from './data/types'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const _dirname = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.resolve(_dirname, './data/locales')

let localesData: Record<string, any> = {}
try {
  localesData = {
    en: JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf-8')),
    fr: JSON.parse(fs.readFileSync(path.join(localesDir, 'fr.json'), 'utf-8')),
    vi: JSON.parse(fs.readFileSync(path.join(localesDir, 'vi.json'), 'utf-8')),
    zh: JSON.parse(fs.readFileSync(path.join(localesDir, 'zh.json'), 'utf-8'))
  }
} catch (e) {
  console.warn('Failed to load locale JSON files', e)
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

function resolveKeyPath(obj: any, path: string): string | undefined {
  try {
    const val = path.split('.').reduce((acc, part) => acc && acc[part], obj)
    return typeof val === 'string' ? val : undefined
  } catch {
    return undefined
  }
}

export function buildTranslationsPayload(fieldKeys: Record<string, string | undefined>): Record<string, Record<string, unknown>> {
  const translations: Record<string, Record<string, unknown>> = {}
  
  for (const [locale, data] of Object.entries(localesData)) {
    const localeContent: Record<string, string> = {}
    for (const [field, keyPath] of Object.entries(fieldKeys)) {
      if (!keyPath) continue
      const val = resolveKeyPath(data, keyPath)
      if (val) {
        localeContent[field] = val
      }
    }
    if (Object.keys(localeContent).length > 0) {
      translations[locale] = localeContent
    }
  }
  
  return translations
}
