import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The create-app template mirror, in one place.
 *
 * A family of script tests asserts that `packages/create-app/template/**`
 * ships a byte-identical copy of a first-party file — the boot script, the
 * compose files, the dev runtime, the i18n catalogs. This fork does not carry
 * `packages/create-app` (see NOTICE.md), so every one of those assertions read
 * a path that cannot exist and failed as ENOENT.
 *
 * The mirror checks stay, guarded, rather than being deleted: that is the same
 * call `scripts/check-token-parity.mjs` already makes for the template copy of
 * globals.css, and it means the parity coverage resumes on its own the day a
 * template returns instead of having to be reconstructed from git history.
 *
 * This guards ONLY the template half. Every assertion about a file this
 * repository actually ships still runs unconditionally — a guard that swallowed
 * those would turn a real regression into a silent skip.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export const TEMPLATE_ROOT = path.join(REPO_ROOT, 'packages/create-app/template')

export function templatePath(relPathInTemplate) {
  return path.join(TEMPLATE_ROOT, relPathInTemplate)
}

export function hasTemplate() {
  return fs.existsSync(TEMPLATE_ROOT)
}

/**
 * Node test options that skip a mirror assertion when the template is absent.
 * Spread as the second argument: `test(name, whenTemplatePresent(), fn)`.
 */
export function whenTemplatePresent() {
  return hasTemplate()
    ? {}
    : { skip: 'packages/create-app is not part of this fork (NOTICE.md) — nothing to mirror' }
}

/**
 * Filters a list of `packages/create-app/template/...` paths down to the ones
 * that exist. Use it where a single test walks first-party sources AND their
 * template mirrors in one loop: the first-party entries stay in the list
 * unconditionally, the mirrors drop out when the template is absent.
 */
export function templateMirrors(...relPathsFromRepoRoot) {
  return hasTemplate() ? relPathsFromRepoRoot : []
}
