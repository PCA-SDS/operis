import fs from 'node:fs'
import path from 'node:path'

export const SKIP_DIRS = new Set(['__tests__', '__mocks__', 'node_modules'])

export function shouldSkipEntryName(name: string): boolean {
  return SKIP_DIRS.has(name) || name === '.DS_Store' || name.startsWith('._')
}

export const SOURCE_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

export function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (shouldSkipEntryName(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }
    const ext = path.extname(entry.name)
    if (!SOURCE_FILE_EXTENSIONS.includes(ext)) continue
    files.push(fullPath)
  }
  return files
}

export function resolveRelativeImportTarget(sourceFile: string, importPath: string): string | null {
  if (!importPath.startsWith('.')) return null

  const basePath = path.resolve(path.dirname(sourceFile), importPath)
  const candidates = [basePath]

  for (const ext of SOURCE_FILE_EXTENSIONS) {
    candidates.push(`${basePath}${ext}`)
    candidates.push(path.join(basePath, `index${ext}`))
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}
