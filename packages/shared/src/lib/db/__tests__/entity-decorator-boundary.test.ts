import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/**
 * Entity decorator boundary guard.
 *
 * Entity decorators come from `@open-mercato/shared/lib/db/decorators` and nowhere else.
 * That shim is load-bearing twice over:
 *
 * 1. It pins the TC39 (Stage-3) decorators. The legacy ones key entity metadata off
 *    `target.constructor.name`, which a minifier mangles — two entity classes collapsing to
 *    the same short identifier merge their metadata buckets. That is why both Next minifiers
 *    were disabled for years, shipping ~62 MB of unminified client JS.
 * 2. It patches two defects in `@mikro-orm/decorators@7`. A subclass's `@Index`/`@Unique`
 *    pushes into the PARENT entity's inherited metadata array, so the parent collects the
 *    child's indexes and the child gets none. And an explicit column `name:` is dropped
 *    (`renameKey` mutates the caller's options AFTER the property was built), so the column
 *    silently takes the property's name instead — on this repo that was five columns
 *    `yarn db:generate` proposed to RENAME on a live database.
 *
 * Every one of those fails QUIETLY: as schema drift, or as a build that dies far from the
 * cause. Nothing about a direct upstream import looks wrong at the call site, so the boundary
 * is worth pinning here rather than trusting convention.
 *
 * ESLint carries the same rule (`no-restricted-imports` in `eslint.config.mjs`) for the
 * keystroke-level signal, but `turbo run lint` only runs in `apps/mercato` — this test is what
 * covers `packages/**`, where every entity file actually lives.
 */

const REPO_ROOT = resolve(__dirname, '../../../../../..')
const SCAN_ROOTS = ['packages', 'apps']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.mercato', 'build', 'coverage', '.turbo'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

const UPSTREAM_DECORATOR_IMPORT = /\bfrom\s*['"]@mikro-orm\/decorators(?:\/[\w-]+)?['"]|\brequire\s*\(\s*['"]@mikro-orm\/decorators(?:\/[\w-]+)?['"]\s*\)/

// The shim is the one file allowed to reach upstream — re-exporting it is its whole job.
const SHIM = join('packages', 'shared', 'src', 'lib', 'db', 'decorators.ts')

function isAllowed(repoRelativePath: string): boolean {
  return repoRelativePath === SHIM
}

/**
 * Tests are exempt: `dynamicLoader.tsconfig.test.ts` and `generatedCacheRecovery.test.ts`
 * write entity sources that import the LEGACY decorators into temp fixtures, deliberately, to
 * exercise the dynamic loader against a legacy tsconfig. Those live inside template strings
 * rather than being real imports, and no test file declares a production entity.
 */
function isTestFile(repoRelativePath: string): boolean {
  return repoRelativePath.includes(`${sep}__tests__${sep}`)
    || repoRelativePath.endsWith('.test.ts')
    || repoRelativePath.endsWith('.test.tsx')
}

// A comment may legitimately name the upstream package while explaining why it is banned.
// Approximate stripping is fine: the output only ever feeds a regex.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) {
      continue
    }
    const absolute = join(dir, entry)
    let stats
    try {
      stats = statSync(absolute)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      collectSourceFiles(absolute, found)
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(absolute)
    }
  }
  return found
}

describe('entity decorator boundary', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => collectSourceFiles(join(REPO_ROOT, root)))

  it('scans a meaningful number of source files', () => {
    // Guards against a broken walk silently passing the assertions below.
    expect(sourceFiles.length).toBeGreaterThan(500)
  })

  it('routes every decorator import through the shim', () => {
    const offenders = sourceFiles
      .map((absolute) => ({ absolute, repoRelative: relative(REPO_ROOT, absolute) }))
      .filter(({ repoRelative }) => !isAllowed(repoRelative) && !isTestFile(repoRelative))
      .filter(({ absolute }) => UPSTREAM_DECORATOR_IMPORT.test(stripComments(readFileSync(absolute, 'utf8'))))
      .map(({ repoRelative }) => repoRelative)

    expect(offenders).toEqual([])
  })

  it('keeps every entity file on the shim', () => {
    // The inverse check: a `data/entities.ts` that imports its decorators from anywhere else
    // (including a hand-rolled local re-export) would pass the rule above while still
    // bypassing the fixes.
    const offenders = sourceFiles
      .map((absolute) => ({ absolute, repoRelative: relative(REPO_ROOT, absolute) }))
      .filter(({ repoRelative }) => repoRelative.endsWith(join('data', 'entities.ts')))
      .filter(({ absolute }) => /@Entity\s*\(/.test(readFileSync(absolute, 'utf8')))
      .filter(({ absolute }) => !readFileSync(absolute, 'utf8').includes('@open-mercato/shared/lib/db/decorators'))
      .map(({ repoRelative }) => repoRelative)

    expect(offenders).toEqual([])
  })

  it('finds the entity files it is meant to cover', () => {
    const entityFiles = sourceFiles
      .map((absolute) => relative(REPO_ROOT, absolute))
      .filter((repoRelative) => repoRelative.endsWith(join('data', 'entities.ts')))
    expect(entityFiles.length).toBeGreaterThan(40)
  })
})
