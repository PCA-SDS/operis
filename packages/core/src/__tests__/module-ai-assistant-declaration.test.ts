/**
 * Repo-wide audit: `ModuleInfo.aiAssistant` must match reality.
 *
 * The flag drives the per-tenant AI sub-toggle on the tenant Modules screen and
 * the enforcement behind it (`resolveAiDisabledModuleIds`). Both directions of
 * drift are bugs an operator would eventually hit and could not diagnose:
 *
 * - Declared but no tools — the screen offers a switch that governs nothing,
 *   and turning it off appears to do nothing because there is nothing to hide.
 * - Tools but undeclared — the module's AI tools stay reachable for every
 *   tenant with no way to withhold them, silently outside the control the
 *   screen claims to provide.
 *
 * A module "ships an AI assistant" when it contributes `ai-tools.ts` or
 * `ai-agents.ts`, which is exactly what the generator collects into the runtime
 * tool registry.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

type ModuleSource = { moduleId: string; moduleDir: string; indexPath: string }

function listDirectories(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
}

function collectModuleSources(): ModuleSource[] {
  const sources: ModuleSource[] = []
  const roots = [
    ...listDirectories(path.join(REPO_ROOT, 'packages'))
      .map((name) => path.join(REPO_ROOT, 'packages', name, 'src', 'modules')),
    ...listDirectories(path.join(REPO_ROOT, 'apps'))
      .map((name) => path.join(REPO_ROOT, 'apps', name, 'src', 'modules')),
  ]
  for (const root of roots) {
    for (const moduleId of listDirectories(root)) {
      const moduleDir = path.join(root, moduleId)
      const indexPath = path.join(moduleDir, 'index.ts')
      if (existsSync(indexPath)) sources.push({ moduleId, moduleDir, indexPath })
    }
  }
  return sources
}

function shipsAiSurface(moduleDir: string): boolean {
  return existsSync(path.join(moduleDir, 'ai-tools.ts'))
    || existsSync(path.join(moduleDir, 'ai-agents.ts'))
}

function declaresAiAssistant(indexPath: string): boolean {
  return /aiAssistant:\s*true/.test(readFileSync(indexPath, 'utf8'))
}

describe('module AI assistant declaration', () => {
  const sources = collectModuleSources()

  it('finds the modules on disk', () => {
    expect(sources.length).toBeGreaterThan(40)
  })

  it('declares aiAssistant for every module that ships AI tools or agents', () => {
    const undeclared = sources
      .filter((source) => shipsAiSurface(source.moduleDir) && !declaresAiAssistant(source.indexPath))
      .map((source) => source.moduleId)

    expect(undeclared).toEqual([])
  })

  it('ships AI tools or agents for every module that declares aiAssistant', () => {
    const hollow = sources
      .filter((source) => declaresAiAssistant(source.indexPath) && !shipsAiSurface(source.moduleDir))
      .map((source) => source.moduleId)

    expect(hollow).toEqual([])
  })
})
