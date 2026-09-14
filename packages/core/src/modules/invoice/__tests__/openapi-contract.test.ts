import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory()
      ? routeFiles(path)
      : entry === 'route.ts'
        ? [path]
        : []
  })
}

describe('Invoice OpenAPI route contract', () => {
  it('exports OpenAPI metadata for every Invoice route with an operation id', () => {
    const files = routeFiles(join(__dirname, '..', 'api'))
    const operationIds = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('export const openApi')
      const matches = [...source.matchAll(/createInvoiceOperationId\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
      expect(matches.length).toBeGreaterThan(0)
      return matches.map((match) => `invoice.${match[1]}.${match[2]}`)
    })

    expect(new Set(operationIds).size).toBe(operationIds.length)
  })
})
