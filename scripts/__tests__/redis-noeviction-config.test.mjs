import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { whenTemplatePresent } from './helpers/create-app-template.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REDIS_CONFIGS = [
  { path: 'docker/redis/redis.conf', options: {} },
  { path: 'packages/create-app/template/docker/redis/redis.conf', options: whenTemplatePresent() },
]

for (const { path: relPath, options } of REDIS_CONFIGS) {
  test(`${relPath} disables key eviction for BullMQ`, options, () => {
    const content = fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')

    assert.match(content, /^maxmemory-policy\s+noeviction\s*$/m)
    assert.doesNotMatch(content, /^maxmemory-policy\s+(?!noeviction\b)\S+/m)
  })
}
