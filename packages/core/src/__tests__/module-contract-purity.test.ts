/**
 * Module contract purity — repo-wide.
 *
 * Sealing a module is only worth something if its contract stays a contract. A
 * `contract.ts` that re-exports an ORM entity hands every caller a class they
 * can pass straight to `em.find`, which re-opens the table the seal just
 * closed — and it does so through a file review treats as "the approved
 * surface". That failure mode is quiet and it is the one that would undo this
 * work, so it is pinned statically rather than left to judgement.
 *
 * The rules:
 *
 *  1. A contract may not import its own module's `data/` layer. Entity classes
 *     and validators are the private shape of the table.
 *  2. A contract may not import another module at all. It publishes what THIS
 *     module owns; re-exporting a neighbour's surface would make it a proxy
 *     for a boundary it does not own.
 *  3. A contract may not import `services/`, `lib/` or `api/`. The contract
 *     declares ADDRESSES — command ids, query-engine entity ids, DI tokens —
 *     which callers resolve at runtime through the bus, the engine or the
 *     container. Importing the implementation defeats the indirection.
 *  4. Declared ids stay inside the module's own namespace. `defineModuleContract`
 *     already throws on this at import time; the static check reports every
 *     offender at once instead of the first one to be loaded.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

const CONTRACT_GLOB = ['packages/*/src/modules/*/contract.ts', 'apps/mercato/src/modules/*/contract.ts']
const IGNORED = ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.mercato/**']

const IMPORT_RE = /(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g

type Contract = { file: string; moduleId: string; source: string; specifiers: string[] }

const contracts: Contract[] = fg.sync(CONTRACT_GLOB, { cwd: REPO_ROOT, ignore: IGNORED }).map((rel) => {
  const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
  const parts = rel.split('/')
  const moduleId = parts[parts.indexOf('modules') + 1]
  const specifiers = [...source.matchAll(IMPORT_RE)].map((match) => match[1])
  return { file: rel, moduleId, source, specifiers }
})

/** Imports a contract is allowed to make. Anything else is a leak. */
const ALLOWED = [
  /^@open-mercato\/shared\/modules\/contract$/,
  /^@open-mercato\/shared\/lib\//,
  /^\.\/acl$/,
  /^\.\/events$/,
]

describe('module contract purity', () => {
  it('finds the contracts it is meant to police', () => {
    expect(contracts.length).toBeGreaterThan(0)
  })

  it('no contract imports its own module\'s data layer', () => {
    const leaks = contracts.flatMap(({ file, specifiers }) =>
      specifiers
        .filter((spec) => /(^|\/)data\/(entities|validators)/.test(spec))
        .map((spec) => `${file} -> ${spec}`),
    )
    expect(leaks).toEqual([])
  })

  it('no contract imports another module', () => {
    const leaks = contracts.flatMap(({ file, moduleId, specifiers }) =>
      specifiers
        .filter((spec) => {
          // `@open-mercato/shared/modules/*` are the platform's shared contract
          // namespaces (`contract`, `registry`, `events`), not other business
          // modules — importing them is the point, not a leak.
          const match = spec.match(/^@open-mercato\/(?!shared\/)[^/]+\/modules\/([^/]+)/)
          return match !== null && match[1] !== moduleId
        })
        .map((spec) => `${file} -> ${spec}`),
    )
    expect(leaks).toEqual([])
  })

  it('no contract imports an implementation folder', () => {
    const leaks = contracts.flatMap(({ file, specifiers }) =>
      specifiers
        .filter((spec) => !ALLOWED.some((allowed) => allowed.test(spec)))
        .filter((spec) => /(^|\/)(services|lib|api|components|backend|frontend|commands|subscribers|workers)\//.test(spec))
        .map((spec) => `${file} -> ${spec}`),
    )
    expect(leaks).toEqual([])
  })

  it('declared ids stay inside the module\'s own namespace', () => {
    const offenders: string[] = []
    for (const { file, moduleId, source } of contracts) {
      for (const [, listName, body] of source.matchAll(/(commands|readModels|events)\s*:\s*\[([^\]]*)\]/g)) {
        const separator = listName === 'readModels' ? ':' : '.'
        for (const [, id] of body.matchAll(/['"]([^'"]+)['"]/g)) {
          if (!id.startsWith(`${moduleId}${separator}`)) offenders.push(`${file} -> ${listName}: ${id}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('every contract calls defineModuleContract with its own directory name', () => {
    const mismatched = contracts
      .filter(({ moduleId, source }) => !new RegExp(`moduleId:\\s*['"]${moduleId}['"]`).test(source))
      .map(({ file }) => file)
    expect(mismatched).toEqual([])
  })
})
