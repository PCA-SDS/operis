/**
 * Seal a module behind its public contract.
 *
 * Sealing does three things, all of them mechanical:
 *
 *   1. Rewrites the module's OWN `@open-mercato/<pkg>/modules/<id>/...`
 *      self-imports to relative paths. A self-import is not a boundary
 *      crossing, and once the module is sealed the package specifier would no
 *      longer resolve.
 *   2. Writes `contract.ts` if absent — the module's public surface, empty
 *      until a real caller needs an entry.
 *   3. Narrows the package `exports` map: `index` and `contract` stay public,
 *      `./modules/<id>/*` becomes null. Node, TypeScript and the bundlers all
 *      honour that, so a deep import stops resolving at COMPILE time.
 *
 * Run it only when `module-seal-integrity.test.ts` reports the module has no
 * remaining deep importers — sealing one that still has callers just breaks
 * them. That guard also fails if a sealable module is left unsealed, so this
 * script is the fix it asks for.
 *
 *   node scripts/seal-module.mjs <package-dir> <module-id> [...more pairs]
 *   node scripts/seal-module.mjs --from-guard        # seal everything eligible
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', 'generated'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function rewriteSelfImports(pkgDir, moduleId) {
  const moduleRoot = path.join(REPO_ROOT, 'packages', pkgDir, 'src/modules', moduleId)
  const specifier = new RegExp(`(['"])@open-mercato/${pkgDir}/modules/${moduleId}(/[^'"]*)?\\1`, 'g')
  let rewritten = 0
  for (const file of walk(moduleRoot)) {
    const before = fs.readFileSync(file, 'utf8')
    const after = before.replace(specifier, (_match, quote, subpath) => {
      // Locale dictionaries are the one self-import that must STAY a package
      // specifier. `packages/core/build.mjs` sets `copyJsonIgnore: ['**/i18n/**']`,
      // so `dist/modules/<id>/i18n/` does not exist; the specifier is what routes
      // these to `src/` through the exports map. Rewriting them to a relative path
      // typechecks against src and then fails the Turbopack build against dist.
      if (subpath && /^\/i18n\/.+\.json$/.test(subpath)) return _match
      const target = path.join(moduleRoot, subpath || 'index')
      let relative = path.relative(path.dirname(file), target).split(path.sep).join('/')
      if (!relative.startsWith('.')) relative = `./${relative}`
      return `${quote}${relative}${quote}`
    })
    if (after !== before) {
      fs.writeFileSync(file, after)
      rewritten += (before.match(specifier) || []).length
    }
  }
  return rewritten
}

function writeContract(pkgDir, moduleId) {
  const file = path.join(REPO_ROOT, 'packages', pkgDir, 'src/modules', moduleId, 'contract.ts')
  if (fs.existsSync(file)) return false
  fs.writeFileSync(file, `import { defineModuleContract } from '@open-mercato/shared/modules/contract'

/**
 * Public contract for \`${moduleId}\`.
 *
 * Everything under \`data/\`, \`lib/\`, \`services/\`, \`components/\` and \`api/\` is
 * private: the package exports map sends \`./modules/${moduleId}/*\` to null, so a
 * cross-module deep import fails to resolve at compile time rather than in review.
 *
 * Empty because no other module consumes ${moduleId} today. Publishing a surface
 * nobody asked for re-creates the wide coupling sealing removed, only sanctioned.
 * Add an entry in the SAME change as the caller that needs it:
 *
 *   commands:   ['${moduleId}.<entity>.<action>']   // cross-module writes, via the command bus
 *   readModels: ['${moduleId}:<entity>']            // cross-module reads, via the query engine
 *
 * Events are public by default and bind by id string — see \`events.ts\`, not here.
 */
export const contract = defineModuleContract({
  moduleId: '${moduleId}',
})

export default contract
`)
  return true
}

function narrowExports(pkgDir, moduleId) {
  const file = path.join(REPO_ROOT, 'packages', pkgDir, 'package.json')
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!json.exports) throw new Error(`[internal] packages/${pkgDir} has no exports map to narrow.`)
  for (const key of Object.keys(json.exports)) {
    if (key === `./modules/${moduleId}` || key.startsWith(`./modules/${moduleId}/`)) delete json.exports[key]
  }
  const i18nDir = path.join(REPO_ROOT, 'packages', pkgDir, 'src/modules', moduleId, 'i18n')
  const i18nEntry = fs.existsSync(i18nDir)
    // Locale dictionaries resolve from src because the build deliberately keeps
    // them out of dist (see rewriteSelfImports). Narrow and explicit: the module's
    // own code and the app's i18n layering read these, nothing else.
    ? { [`./modules/${moduleId}/i18n/*.json`]: `./src/modules/${moduleId}/i18n/*.json` }
    : {}

  json.exports = {
    ...i18nEntry,
    [`./modules/${moduleId}`]: {
      types: `./src/modules/${moduleId}/index.ts`,
      default: `./dist/modules/${moduleId}/index.js`,
    },
    [`./modules/${moduleId}/contract`]: {
      types: `./src/modules/${moduleId}/contract.ts`,
      default: `./dist/modules/${moduleId}/contract.js`,
    },
    [`./modules/${moduleId}/*`]: null,
    ...json.exports,
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
}

const args = process.argv.slice(2)
if (args.length === 0 || args.length % 2 !== 0) {
  console.error('usage: node scripts/seal-module.mjs <package-dir> <module-id> [...]')
  process.exit(1)
}
for (let i = 0; i < args.length; i += 2) {
  const [pkgDir, moduleId] = [args[i], args[i + 1]]
  const rewritten = rewriteSelfImports(pkgDir, moduleId)
  const wroteContract = writeContract(pkgDir, moduleId)
  narrowExports(pkgDir, moduleId)
  console.log(
    `sealed ${pkgDir}/${moduleId} — ${rewritten} self-import(s) made relative`
    + `${wroteContract ? ', contract.ts created' : ', contract.ts already present'}`,
  )
}
