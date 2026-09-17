/**
 * Module seal integrity — repo-wide.
 *
 * A SEALED module is one whose package `exports` map sends `./modules/<id>/*`
 * to `null`. Node, TypeScript, webpack and Turbopack all honour that, so a deep
 * import into a sealed module does not resolve — the boundary is a compile
 * error, not a review comment. See
 * `docs/architecture/modular-monolith-audit-2026-09-17.md` §E-3.
 *
 * This guard pins the four things the exports map alone cannot:
 *
 *  1. A sealed module declares a contract (`contract.ts`), so "sealed" always
 *     means "has a published surface", never "unreachable".
 *  2. Nothing reaches a sealed module's internals through a RELATIVE path.
 *     `../../invoice/data/entities` never touches the exports map, so without
 *     this check the seal would have a silent hole — and 186 such relative
 *     escapes already exist between unsealed modules.
 *  3. the `internal` composition-root subpath appears only in generated output. That
 *     subpath is the composition root's key to every module's private files; a
 *     hand-written file using it would walk straight around every seal.
 *  4. A module that NOTHING imports deeply MUST be sealed.
 *
 * Rule 4 is what makes this a one-way door without a hand-maintained baseline.
 * A count-based ratchet freezes debt and calls it progress; this instead makes
 * the seal follow the code — the moment the last deep importer of a module is
 * migrated, CI requires that module to be sealed, and it can never drift back.
 * Nobody has to remember, and there is no number to argue about.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

type ModuleRef = { pkg: string; mod: string }

/**
 * Every hand-written source file in the repo — not just files inside module
 * trees. A module can be deep-imported from `apps/mercato/src/app/**`,
 * `packages/shared/src/lib/**` or `packages/ui/src/**` just as easily as from a
 * sibling module, and scoping this scan to module trees would let rule 4 seal a
 * module that one of those still reaches into.
 */
const ALL_SOURCE_GLOB = [
  'packages/*/src/**/*.{ts,tsx}',
  'apps/mercato/src/**/*.{ts,tsx}',
]

const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/.mercato/**',
  '**/generated/**',
]

const isTestPath = (p: string) => /__tests__|__integration__|\.test\.|\.spec\./.test(p)

function packageNameToDir(pkgName: string): string | null {
  const match = pkgName.match(/^@open-mercato\/(.+)$/)
  return match ? match[1] : null
}

/** Modules whose `./modules/<id>/*` export is null, keyed as "<pkgDir>/<mod>". */
function readSealedModules(): Map<string, { pkgDir: string; mod: string }> {
  const sealed = new Map<string, { pkgDir: string; mod: string }>()
  const pkgJsonPaths = fg.sync('packages/*/package.json', { cwd: REPO_ROOT, ignore: IGNORED })
  for (const rel of pkgJsonPaths) {
    const pkgDir = rel.split('/')[1]
    const json = JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8')) as {
      exports?: Record<string, unknown>
    }
    for (const [subpath, target] of Object.entries(json.exports ?? {})) {
      const match = subpath.match(/^\.\/modules\/([a-z0-9_]+)\/\*$/)
      if (match && target === null) sealed.set(`${pkgDir}/${match[1]}`, { pkgDir, mod: match[1] })
    }
  }
  return sealed
}

function ownerOf(relPath: string): ModuleRef | null {
  let m = relPath.match(/^packages\/([^/]+)\/src\/modules\/([^/]+)\//)
  if (m) return { pkg: m[1], mod: m[2] }
  m = relPath.match(/^apps\/mercato\/src\/modules\/([^/]+)\//)
  if (m) return { pkg: 'app', mod: m[1] }
  return null
}

const IMPORT_RE = /(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g

function specifiersOf(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3]
    if (spec) out.push(spec)
  }
  return out
}

type DeepImport = { file: string; spec: string; target: ModuleRef; viaRelativePath: boolean }

/** Every import that reaches INTO a module's private files, from outside that module. */
function collectDeepImports(): DeepImport[] {
  const files = fg.sync(ALL_SOURCE_GLOB, { cwd: REPO_ROOT, ignore: IGNORED })
  const found: DeepImport[] = []
  for (const rel of files) {
    if (isTestPath(rel)) continue
    // `ownerOf` is null for files outside a module tree (app routes, shared
    // libs, ui). Those still count as importers — they simply own no module, so
    // every deep import they make is by definition cross-module.
    const owner = ownerOf(rel)
    const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    for (const spec of specifiersOf(source)) {
      // Package-specifier form: @open-mercato/<pkg>/modules/<mod>/<subpath>
      const pkgMatch = spec.match(/^@open-mercato\/([^/]+)\/modules\/([^/]+)\/(.+)$/)
      if (pkgMatch) {
        const target = { pkg: pkgMatch[1], mod: pkgMatch[2] }
        if (owner && target.pkg === owner.pkg && target.mod === owner.mod) continue
        found.push({ file: rel, spec, target, viaRelativePath: false })
        continue
      }
      if (!spec.startsWith('.')) continue
      // Relative form — resolve and see whether it landed in another module.
      const absolute = path.resolve(path.dirname(path.join(REPO_ROOT, rel)), spec)
      const resolvedRel = path.relative(REPO_ROOT, absolute)
      const targetOwner = ownerOf(`${resolvedRel}/`)
      if (!targetOwner) continue
      if (owner && targetOwner.pkg === owner.pkg && targetOwner.mod === owner.mod) continue
      const tail = resolvedRel.replace(/^.*\/modules\/[^/]+\//, '')
      if (!tail || tail === 'index' || tail === 'contract') continue
      found.push({ file: rel, spec, target: targetOwner, viaRelativePath: true })
    }
  }
  return found
}

/**
 * `packages/shared/src/modules/*` are not modules in the sense this guard
 * polices. They are the platform's shared contract namespaces — `registry`,
 * `events`, `widgets`, `setup` — that every module is SUPPOSED to import, and
 * none of them owns a table. Sealing them would be a category error, so they
 * are excluded from the "must be sealed" rule rather than carried as debt.
 */
const NON_MODULE_PACKAGES = new Set(['shared'])

const sealed = readSealedModules()
const deepImports = collectDeepImports()

describe('module seal integrity', () => {
  it('seals at least one module (the guard is wired to real data)', () => {
    expect(sealed.size).toBeGreaterThan(0)
  })

  it('every sealed module publishes a contract.ts', () => {
    const missing = [...sealed.values()]
      .filter(({ pkgDir, mod }) => !existsSync(path.join(REPO_ROOT, 'packages', pkgDir, 'src/modules', mod, 'contract.ts')))
      .map(({ pkgDir, mod }) => `${pkgDir}/${mod}`)
    expect(missing).toEqual([])
  })

  it('nothing imports a sealed module\'s internals', () => {
    const breaches = deepImports
      .filter((imp) => sealed.has(`${imp.target.pkg}/${imp.target.mod}`))
      .map((imp) => `${imp.file} -> ${imp.spec}`)
    expect(breaches).toEqual([])
  })

  it('no relative path escapes into a sealed module (the exports map cannot see these)', () => {
    const escapes = deepImports
      .filter((imp) => imp.viaRelativePath && sealed.has(`${imp.target.pkg}/${imp.target.mod}`))
      .map((imp) => `${imp.file} -> ${imp.spec}`)
    expect(escapes).toEqual([])
  })

  it('the /internal/ composition-root subpath is used only by generated output', () => {
    const handWritten = fg.sync(
      ['packages/*/src/**/*.{ts,tsx}', 'apps/mercato/src/**/*.{ts,tsx}'],
      { cwd: REPO_ROOT, ignore: IGNORED },
    )
    const offenders: string[] = []
    for (const rel of handWritten) {
      const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
      for (const spec of specifiersOf(source)) {
        if (/^@open-mercato\/[^/]+\/internal\//.test(spec)) offenders.push(`${rel} -> ${spec}`)
      }
    }
    // The generator emits this prefix; the strings that BUILD it live in the CLI
    // and in module `generators.ts` files, which are code-generating code, not
    // consumers. Those are matched by their `generators.ts` / cli generator path.
    const realOffenders = offenders.filter((entry) => !/\/generators\.ts|packages\/cli\/src\/lib\/generators\//.test(entry))
    expect(realOffenders).toEqual([])
  })

  it('a module with no remaining deep importers is sealed', () => {
    const deeplyImported = new Set(deepImports.map((imp) => `${imp.target.pkg}/${imp.target.mod}`))
    const allModules = fg
      .sync('packages/*/src/modules/*/index.ts', { cwd: REPO_ROOT, ignore: IGNORED })
      .map((rel) => {
        const parts = rel.split('/')
        return { key: `${parts[1]}/${parts[4]}`, pkgDir: parts[1], mod: parts[4] }
      })
    const shouldBeSealed = allModules
      .filter(({ pkgDir }) => !NON_MODULE_PACKAGES.has(pkgDir))
      .filter(({ key }) => !deeplyImported.has(key) && !sealed.has(key))
      .map(({ key }) => key)
      .sort()
    expect(shouldBeSealed).toEqual([])
  })
})
