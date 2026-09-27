/**
 * A page's `loadingSkeleton` is a promise about its layout: the route-level
 * loading state draws that shape while the page loads, and the page must land
 * on it. A declaration on a page with some other layout brings back the jump
 * the declaration exists to prevent, so each kind is held to the component
 * that draws that layout.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const MODULES_ROOT = path.resolve(__dirname, '../modules')

const EXPECTED_COMPONENT: Record<string, RegExp> = {
  list: /<DataTable\b/,
  detail: /<DetailPageSkeleton\b/,
  calendar: /<CalendarScreen\b/,
  conversation: /<ChatShell\b/,
}

function collectPageMetaFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) collectPageMetaFiles(full, found)
    else if (entry === 'page.meta.ts' && full.includes(`${path.sep}backend${path.sep}`)) found.push(full)
  }
  return found
}

const declarations = collectPageMetaFiles(MODULES_ROOT).flatMap((metaPath) => {
  const match = readFileSync(metaPath, 'utf8').match(/loadingSkeleton:\s*'([a-z]+)'/)
  return match ? [{ metaPath, kind: match[1]! }] : []
})

describe('loadingSkeleton declarations', () => {
  it('are made by some pages', () => {
    expect(declarations.length).toBeGreaterThan(0)
  })

  it.each(declarations.map((declaration) => [path.relative(MODULES_ROOT, declaration.metaPath), declaration.kind]))(
    '%s declares a %s skeleton for a page that draws that layout',
    (relativeMetaPath, kind) => {
      const expected = EXPECTED_COMPONENT[kind]
      expect(expected).toBeDefined()
      const pagePath = path.join(MODULES_ROOT, path.dirname(relativeMetaPath), 'page.tsx')
      expect(readFileSync(pagePath, 'utf8')).toMatch(expected!)
    },
  )
})
