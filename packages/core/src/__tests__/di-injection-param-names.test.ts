import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { transformSync } from 'esbuild'

/**
 * DI injection parameter-name audit.
 *
 * Request containers use Awilix CLASSIC injection, which resolves an
 * `asFunction((em) => ...)` factory by parsing its parameter NAMES. The package
 * build compiles each file with esbuild, and esbuild renames a parameter that
 * shadows an outer binding (`em` becomes `em2`). The built factory then asks the
 * container for a registration that does not exist. That is how
 * `crudMutationGuardService` became unresolvable in every built package and
 * silently switched the optimistic-lock guard off.
 *
 * Jest compiles from source and never sees the rename, so a resolution test
 * cannot catch it. This audit compiles every non-test source file that
 * registers an inline `asFunction` factory with the build's own esbuild
 * options, and fails when an injected parameter name differs between source
 * and output. Use `.proxy()` with a destructured cradle instead: property keys
 * are never renamed.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__integration__', 'generated', 'dist', '.next', '.mercato'])
const INLINE_FACTORY = /asFunction\(\s*(?:async\s+)?(?:function\s*[\w$]*\s*)?\(/g

function discoverSourceRoots(): string[] {
  const roots: string[] = []
  for (const name of readdirSync(join(repoRoot, 'packages')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const srcDir = join(repoRoot, 'packages', name, 'src')
    try {
      if (statSync(srcDir).isDirectory()) roots.push(srcDir)
    } catch {
      // package without a src directory
    }
  }
  const appSrc = join(repoRoot, 'apps', 'mercato', 'src')
  try {
    if (statSync(appSrc).isDirectory()) roots.push(appSrc)
  } catch {
    // app not present
  }
  return roots
}

function collectFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectFiles(full, files)
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') && !/\.(test|spec)\.tsx?$/.test(entry)) {
      files.push(full)
    }
  }
}

function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if ('([{<'.includes(char)) depth += 1
    if (')]}>'.includes(char)) depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

function readParameterList(code: string, openIndex: number): string {
  let depth = 1
  let index = openIndex
  while (index < code.length && depth > 0) {
    const char = code[index]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    index += 1
  }
  return code.slice(openIndex, index - 1)
}

/** Positional parameter names of each inline factory; `null` for a destructured (proxy) factory. */
function injectedParameterNames(code: string): Array<string[] | null> {
  const factories: Array<string[] | null> = []
  for (const match of code.matchAll(INLINE_FACTORY)) {
    const list = readParameterList(code, (match.index ?? 0) + match[0].length)
    const parameters = splitTopLevel(list).map((part) => part.trim()).filter(Boolean)
    if (parameters.some((parameter) => parameter.startsWith('{') || parameter.startsWith('['))) {
      factories.push(null)
      continue
    }
    factories.push(parameters.map((parameter) => parameter.split(/[:=?]/)[0].trim()))
  }
  return factories
}

function compileLikeThePackageBuild(source: string, file: string): string {
  return transformSync(source, {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'esm',
    platform: 'node',
    target: 'node18',
    jsx: 'automatic',
  }).code
}

describe('DI injection parameter names survive the package build', () => {
  const files: string[] = []
  for (const root of discoverSourceRoots()) collectFiles(root, files)
  const registeringFiles = files.filter((file) => readFileSync(file, 'utf8').includes('asFunction('))

  it('finds the registrations it is meant to audit', () => {
    expect(registeringFiles.map((file) => relative(repoRoot, file).split(sep).join('/'))).toContain(
      'packages/shared/src/lib/di/container.ts',
    )
  })

  it('keeps every injected parameter name unchanged after compilation', () => {
    const renamed: string[] = []
    for (const file of registeringFiles) {
      const source = readFileSync(file, 'utf8')
      const before = injectedParameterNames(source)
      const after = injectedParameterNames(compileLikeThePackageBuild(source, file))
      before.forEach((names, index) => {
        const compiled = after[index]
        if (!names || !compiled) return
        names.forEach((name, position) => {
          if (compiled[position] !== name) {
            renamed.push(`${relative(repoRoot, file).split(sep).join('/')}: '${name}' compiles to '${compiled[position]}'`)
          }
        })
      })
    }
    expect(renamed).toEqual([])
  })
})
