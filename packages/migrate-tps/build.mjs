import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage } from '../../scripts/build-package.mjs'
import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'

const packageDir = dirname(fileURLToPath(import.meta.url))

await buildPackage(packageDir, {
  name: 'migrate-tps',
  copyJson: true,
})

// Copy data files to dist
const srcDataDir = join(packageDir, 'data')
const distDataDir = join(packageDir, 'dist', 'data')
if (existsSync(srcDataDir)) {
  mkdirSync(distDataDir, { recursive: true })
  for (const file of readdirSync(srcDataDir)) {
    copyFileSync(join(srcDataDir, file), join(distDataDir, file))
  }
}
