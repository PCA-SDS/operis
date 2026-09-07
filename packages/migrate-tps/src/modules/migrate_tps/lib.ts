import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function parseTpsMigrateFlags(rest: string[]): { tenantId: string | undefined; organizationId: string | undefined; replace: boolean } {
  let tenantId: string | undefined
  let organizationId: string | undefined
  let replace = false

  const positionalArgs: string[] = []

  for (let i = 0; i < rest.length; i++) {
    const part = rest[i]
    if (!part) continue

    if (part === '--replace') {
      replace = true
    } else if (part.startsWith('--')) {
      // Ignore other flags
    } else {
      positionalArgs.push(part)
    }
  }

  if (positionalArgs.length > 0) tenantId = positionalArgs[0]
  if (positionalArgs.length > 1) organizationId = positionalArgs[1]

  return { tenantId, organizationId, replace }
}

// ---------------------------------------------------------------------------
// CSV fallback (used when TPS_DATABASE_URL is unset)
// ---------------------------------------------------------------------------

const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data')

export function getTpsDataDir(): string {
  return process.env.TPS_DATA_DIR || DEFAULT_DATA_DIR
}

/** Split one CSV record, honouring quoted fields and escaped quotes. */
export function parseTpsCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

/**
 * Read a TPS CSV export into header-keyed rows.
 *
 * `branches.ts` and `resources.ts` both read `tps_floors.csv`; they used to do
 * it with two different parsers, one of which split on every comma and read the
 * location by column index, so a single quoted field would have made the two
 * commands disagree about the same file.
 */
export function parseTpsCsv<T>(filename: string): T[] {
  const filePath = path.join(getTpsDataDir(), filename)
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n')
  if (lines.length === 0) return []
  const headers = parseTpsCsvLine(lines[0]).map((header) => header.replace(/^"|"$/g, ''))
  const rows: T[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseTpsCsvLine(lines[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] ?? ''
    rows.push(row as T)
  }
  return rows
}
