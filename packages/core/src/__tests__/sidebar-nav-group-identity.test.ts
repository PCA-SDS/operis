import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Sidebar nav-group identity audit.
 *
 * `buildAdminNav` (packages/ui/src/backend/utils/nav.ts) keys a nav group by
 * `pageGroupKey ?? pageGroup`, and falls back to `capitalize(moduleId)` for a
 * route that declares neither. A module that declares `pageGroupKey` on some of
 * its pages and nothing on the rest therefore ships TWO groups whose rendered
 * label is identical — the sidebar paints the same heading twice and splits one
 * module's pages across both. The `tasks` module shipped exactly that: My Tasks
 * / Projects / Team under `tasks.nav.group`, and All Tasks / Assigned to Me /
 * Completed / Upcoming under the `capitalize('tasks')` fallback, the second set
 * with no icon because a page that forgets its group usually forgot its icon too.
 *
 * Nothing in the type system catches this — both halves are valid metadata, and
 * the collision only exists once the labels are rendered side by side. So it is
 * audited here, across every module in the repo, rather than left to review.
 *
 * Groups are compared per page context: `main`, `settings` and `profile` render
 * in different rails, so `Auth` appearing in both the main nav and the settings
 * nav is not a collision.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const MODULE_ROOTS = ['packages', 'apps'] as const

type PageMeta = {
  file: string
  group: string
  groupId: string
  context: string
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Mirrors `buildAdminNav`'s reader: the `page*` alias wins, the bare name is the legacy spelling. */
function readAliasedString(source: string, primary: string, legacy: string): string | undefined {
  for (const key of [primary, legacy]) {
    const match = new RegExp(`\\b${key}:\\s*'([^']*)'`).exec(source)
    if (match) return match[1]
  }
  return undefined
}

function discoverModuleDirs(): string[] {
  const found: string[] = []
  for (const root of MODULE_ROOTS) {
    let workspaces: string[]
    try {
      workspaces = readdirSync(join(repoRoot, root))
    } catch {
      continue
    }
    for (const workspace of workspaces.sort()) {
      const modulesDir = join(repoRoot, root, workspace, 'src', 'modules')
      let modules: string[]
      try {
        if (!statSync(modulesDir).isDirectory()) continue
        modules = readdirSync(modulesDir)
      } catch {
        continue
      }
      for (const moduleId of modules.sort()) {
        const backendDir = join(modulesDir, moduleId, 'backend')
        try {
          if (statSync(backendDir).isDirectory()) found.push(backendDir)
        } catch {
          // module without backend pages — nothing to group
        }
      }
    }
  }
  return found
}

function collectPageMetaFiles(directory: string, collected: string[]): string[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return collected
  }
  for (const entry of entries) {
    const full = join(directory, entry)
    let isDirectory = false
    try {
      isDirectory = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDirectory) collectPageMetaFiles(full, collected)
    else if (entry === 'page.meta.ts' || entry === 'page.meta.tsx') collected.push(full)
  }
  return collected
}

function readModulePages(backendDir: string, moduleId: string): PageMeta[] {
  const pages: PageMeta[] = []
  for (const file of collectPageMetaFiles(backendDir, [])) {
    const routePath = relative(backendDir, file).split(sep).slice(0, -1).join('/')
    // Dynamic segments never reach the nav, and neither do explicitly hidden pages.
    if (routePath.includes('[')) continue
    const source = readFileSync(file, 'utf8')
    if (/\bnavHidden:\s*true/.test(source)) continue
    const group = readAliasedString(source, 'pageGroup', 'group') ?? capitalize(moduleId)
    const groupKey = readAliasedString(source, 'pageGroupKey', 'groupKey')
    const context = readAliasedString(source, 'pageContext', 'pageContext') ?? 'main'
    pages.push({ file: relative(repoRoot, file), group, groupId: groupKey ?? group, context })
  }
  return pages
}

describe('sidebar nav group identity', () => {
  it('never renders two groups with the same label in one module and page context', () => {
    const collisions: string[] = []

    for (const backendDir of discoverModuleDirs()) {
      const moduleId = relative(repoRoot, join(backendDir, '..')).split(sep).pop() as string
      const byLabelAndContext = new Map<string, Map<string, string[]>>()

      for (const page of readModulePages(backendDir, moduleId)) {
        const bucketKey = `${page.context}::${page.group}`
        const byGroupId = byLabelAndContext.get(bucketKey) ?? new Map<string, string[]>()
        byGroupId.set(page.groupId, [...(byGroupId.get(page.groupId) ?? []), page.file])
        byLabelAndContext.set(bucketKey, byGroupId)
      }

      for (const [bucketKey, byGroupId] of byLabelAndContext) {
        if (byGroupId.size < 2) continue
        const [context, label] = bucketKey.split('::')
        const detail = [...byGroupId.entries()]
          .map(([groupId, files]) => `      ${groupId}\n${files.map((f) => `        ${f}`).join('\n')}`)
          .join('\n')
        collisions.push(
          `  ${moduleId} renders "${label}" as ${byGroupId.size} groups in the ${context} nav:\n${detail}`,
        )
      }
    }

    expect(collisions.join('\n')).toBe('')
  })
})
