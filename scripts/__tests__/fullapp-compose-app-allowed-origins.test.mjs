import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { whenTemplatePresent } from './helpers/create-app-template.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const COMPOSE_FILES = [
  { path: 'docker-compose.fullapp.dev.yml', options: {} },
  { path: 'docker-compose.fullapp.yml', options: {} },
  { path: 'packages/create-app/template/docker-compose.fullapp.dev.yml', options: whenTemplatePresent() },
  { path: 'packages/create-app/template/docker-compose.fullapp.yml', options: whenTemplatePresent() },
]

function readCompose(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
}

for (const { path: relPath, options } of COMPOSE_FILES) {
  test(`${relPath} forwards APP_ALLOWED_ORIGINS into the app service`, options, () => {
    const content = readCompose(relPath)
    assert.match(
      content,
      /APP_ALLOWED_ORIGINS:\s*\$\{APP_ALLOWED_ORIGINS:-\}/,
      `${relPath} must forward APP_ALLOWED_ORIGINS so the env-backed origin allowlist reaches the app container`
    )
  })

  test(`${relPath} forwards APP_ALLOWED_ORIGINS alongside APP_URL`, options, () => {
    const content = readCompose(relPath)
    assert.ok(
      content.includes('APP_URL:'),
      `${relPath} should still forward APP_URL`
    )
  })
}
