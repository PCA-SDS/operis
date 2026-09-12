#!/usr/bin/env node
/**
 * Local Matrix homeserver lifecycle for the chat transport.
 *
 *   yarn matrix:up       generate config + secrets if missing, start, wait healthy
 *   yarn matrix:status    report what is running and whether config has drifted
 *   yarn matrix:down      stop and remove the containers, keep the data
 *   yarn matrix:reset     down, plus drop the database volume and .matrix-dev/
 *
 * Everything it writes lands in .matrix-dev/ (git-ignored) because it is either
 * secret (tokens, signing key, database password) or machine state (media
 * store). The reviewable half — the homeserver config and the Element config —
 * is committed under docker/matrix/.
 *
 * Idempotent by construction: secrets and the signing key are generated once and
 * reused, while homeserver.yaml is re-rendered on every run so an edit to the
 * committed template actually takes effect.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_DIR = path.join(ROOT, '.matrix-dev')
const SYNAPSE_DIR = path.join(DEV_DIR, 'synapse')
const TEMPLATE = path.join(ROOT, 'docker', 'matrix', 'synapse', 'homeserver.yaml.template')
const LOG_CONFIG = path.join(ROOT, 'docker', 'matrix', 'synapse', 'log.config')
const SECRETS_FILE = path.join(SYNAPSE_DIR, 'secrets.env')
const COMPOSE_ENV = path.join(DEV_DIR, 'compose.env')
const APP_ENV = path.join(DEV_DIR, 'matrix.env')
const SIGNING_KEY = path.join(SYNAPSE_DIR, 'signing.key')
const REGISTRATION = path.join(SYNAPSE_DIR, 'registration.operis.yaml')

const SYNAPSE_IMAGE = 'ghcr.io/element-hq/synapse:v1.160.0'
const SERVICES = ['matrix-postgres', 'synapse', 'element']
const PG_VOLUME = 'mercato-matrix-postgres-data'

const SERVER_NAME = process.env.OM_MATRIX_SERVER_NAME || 'operis.local'
const SYNAPSE_PORT = process.env.MATRIX_SYNAPSE_PORT || '8008'
const ELEMENT_PORT = process.env.MATRIX_ELEMENT_PORT || '8009'

/**
 * The appservice owns every localpart matching this prefix. It is baked into the
 * registration's exclusive namespace regex, so changing it later orphans every
 * identity already created under the old one.
 */
const USER_PREFIX = 'om_'
const SENDER_LOCALPART = 'operis'

/**
 * A namespaced user that is NOT the appservice's own sender.
 *
 * Synapse refuses `/sync` for an appservice's `sender_localpart` outright —
 * "We no longer support AS users using /sync directly" (matrix-doc#1144) — so
 * anything that needs to read a timeline has to be a different, namespaced
 * account. The mautrix bridges do the same thing for the same reason.
 */
const BOT_LOCALPART = 'om_bot'

const log = (msg) => process.stdout.write(`${msg}\n`)
const step = (msg) => log(`\x1b[36m▸\x1b[0m ${msg}`)
const ok = (msg) => log(`\x1b[32m✓\x1b[0m ${msg}`)
const warn = (msg) => log(`\x1b[33m!\x1b[0m ${msg}`)

function fail(msg) {
  process.stderr.write(`\x1b[31m✗ ${msg}\x1b[0m\n`)
  process.exit(1)
}

function docker(args, opts = {}) {
  return execFileSync('docker', args, { cwd: ROOT, encoding: 'utf8', ...opts })
}

function dockerCompose(args, opts = {}) {
  const base = fs.existsSync(COMPOSE_ENV) ? ['compose', '--env-file', COMPOSE_ENV] : ['compose']
  return spawnSync('docker', [...base, ...args], { cwd: ROOT, stdio: 'inherit', ...opts })
}

function requireDocker() {
  const probe = spawnSync('docker', ['info'], { stdio: 'ignore' })
  if (probe.status !== 0) fail('Docker is not running. Start Docker Desktop and try again.')
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const eq = line.indexOf('=')
        return [line.slice(0, eq), line.slice(eq + 1)]
      }),
  )
}

function writeSecret(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o600 })
}

const token = () => randomBytes(32).toString('hex')

/**
 * Generated once and reused forever after.
 *
 * Rotating `as_token` invalidates the appservice's credential; rotating the
 * signing key changes the homeserver's identity. Neither is something a routine
 * `matrix:up` should do behind the developer's back, so this only fills in what
 * is missing.
 */
function ensureSecrets() {
  const existing = readEnvFile(SECRETS_FILE)
  const secrets = {
    MATRIX_SERVER_NAME: SERVER_NAME,
    MATRIX_PUBLIC_BASEURL: `http://localhost:${SYNAPSE_PORT}/`,
    MATRIX_PG_USER: existing.MATRIX_PG_USER || 'synapse',
    MATRIX_PG_DATABASE: existing.MATRIX_PG_DATABASE || 'synapse',
    MATRIX_PG_PASSWORD: existing.MATRIX_PG_PASSWORD || token(),
    MATRIX_MACAROON_SECRET: existing.MATRIX_MACAROON_SECRET || token(),
    MATRIX_FORM_SECRET: existing.MATRIX_FORM_SECRET || token(),
    MATRIX_REGISTRATION_SHARED_SECRET: existing.MATRIX_REGISTRATION_SHARED_SECRET || token(),
    MATRIX_AS_TOKEN: existing.MATRIX_AS_TOKEN || token(),
    MATRIX_HS_TOKEN: existing.MATRIX_HS_TOKEN || token(),
  }

  // The server name is the one value that must never silently change: it is
  // embedded in every user id and room id the homeserver has ever minted.
  if (existing.MATRIX_SERVER_NAME && existing.MATRIX_SERVER_NAME !== SERVER_NAME) {
    fail(
      `Refusing to change server_name from "${existing.MATRIX_SERVER_NAME}" to "${SERVER_NAME}".\n` +
        `  Every existing user id and room id contains the old name; changing it strands all of them.\n` +
        `  Run "yarn matrix:reset" first if that is genuinely what you want.`,
    )
  }

  const fresh = Object.keys(secrets).filter((k) => !existing[k])
  writeSecret(
    SECRETS_FILE,
    [
      '# Generated by scripts/matrix-dev.mjs. Never commit this file.',
      ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`),
      '',
    ].join('\n'),
  )
  if (fresh.length) ok(`generated ${fresh.length} secret(s)`)
  return secrets
}

function ensureSigningKey() {
  if (fs.existsSync(SIGNING_KEY)) return
  step('generating homeserver signing key')
  // Generated by Synapse itself rather than by hand. The format is a specific
  // ed25519 seed encoding and getting it subtly wrong produces a homeserver
  // that starts and then fails to sign anything.
  const key = docker([
    'run', '--rm', '--entrypoint', '/bin/sh', SYNAPSE_IMAGE,
    '-c', 'generate_signing_key -o /dev/stdout',
  ]).trim()
  if (!key.startsWith('ed25519 ')) fail(`unexpected signing key output: ${key.slice(0, 40)}`)
  writeSecret(SIGNING_KEY, `${key}\n`)
  ok('signing key created')
}

function renderHomeserverConfig(secrets) {
  const template = fs.readFileSync(TEMPLATE, 'utf8')
  const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (!(name in secrets)) fail(`template references \${${name}} but no such value was generated`)
    return secrets[name]
  })
  // A leftover placeholder means a value silently became the literal string
  // "${MATRIX_PG_PASSWORD}" — which Synapse would happily accept as a password
  // and then fail to connect with, several confusing minutes later.
  const leftover = rendered.match(/\$\{[A-Z0-9_]+\}/)
  if (leftover) fail(`unsubstituted placeholder left in config: ${leftover[0]}`)
  writeSecret(path.join(SYNAPSE_DIR, 'homeserver.yaml'), rendered)
  fs.copyFileSync(LOG_CONFIG, path.join(SYNAPSE_DIR, 'log.config'))
}

function renderRegistration(secrets) {
  const yaml = `# Matrix application service registration for Operis.
#
# Generated by scripts/matrix-dev.mjs — contains live credentials, never commit.
#
# \`url: null\` means the homeserver never pushes transactions to us; Operis pulls
# with /sync instead. That leaves no inbound endpoint to authenticate or defend,
# which is the right trade while every message is also sent by Operis. Phase 4
# (bridges originating messages we did not send) will need push mode and a
# /transactions endpoint.
id: operis-chat
url: null
as_token: "${secrets.MATRIX_AS_TOKEN}"
hs_token: "${secrets.MATRIX_HS_TOKEN}"
sender_localpart: ${SENDER_LOCALPART}
namespaces:
  users:
    # Exclusive: no account outside the appservice may ever hold one of these
    # localparts, so an Operis identity cannot be impersonated by a real signup.
    #
    # Single-quoted, because these are regexes: a double-quoted YAML scalar
    # processes backslash escapes and rejects '\\.' as an unknown escape.
    - exclusive: true
      regex: '@${USER_PREFIX}.*:${SERVER_NAME.replace(/\./g, '\\.')}'
  aliases:
    - exclusive: true
      regex: '#${USER_PREFIX}.*'
  rooms: []
# Operis rate limits in chat/lib/rateLimits.ts; a second, invisible limit inside
# Synapse would throttle backfill and be attributed to the wrong layer.
rate_limited: false
`
  writeSecret(REGISTRATION, yaml)
}

function writeEnvFiles(secrets) {
  writeSecret(
    COMPOSE_ENV,
    [
      '# Generated by scripts/matrix-dev.mjs — consumed by docker compose --env-file.',
      `MATRIX_PG_USER=${secrets.MATRIX_PG_USER}`,
      `MATRIX_PG_PASSWORD=${secrets.MATRIX_PG_PASSWORD}`,
      `MATRIX_PG_DATABASE=${secrets.MATRIX_PG_DATABASE}`,
      `MATRIX_SYNAPSE_PORT=${SYNAPSE_PORT}`,
      `MATRIX_ELEMENT_PORT=${ELEMENT_PORT}`,
      '',
    ].join('\n'),
  )

  writeSecret(
    APP_ENV,
    [
      '# Generated by scripts/matrix-dev.mjs.',
      '# Copy these into apps/mercato/.env to point Operis at the local homeserver.',
      `OM_MATRIX_HOMESERVER_URL=http://127.0.0.1:${SYNAPSE_PORT}`,
      `OM_MATRIX_SERVER_NAME=${SERVER_NAME}`,
      `OM_MATRIX_AS_TOKEN=${secrets.MATRIX_AS_TOKEN}`,
      `OM_MATRIX_HS_TOKEN=${secrets.MATRIX_HS_TOKEN}`,
      `OM_MATRIX_SENDER_LOCALPART=${SENDER_LOCALPART}`,
      `OM_MATRIX_USER_PREFIX=${USER_PREFIX}`,
      `OM_MATRIX_BOT_LOCALPART=${BOT_LOCALPART}`,
      '',
    ].join('\n'),
  )
}

async function waitForHealth(timeoutMs = 180_000) {
  const url = `http://127.0.0.1:${SYNAPSE_PORT}/_matrix/client/versions`
  const deadline = Date.now() + timeoutMs
  process.stdout.write('\x1b[36m▸\x1b[0m waiting for Synapse')
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const body = await res.json()
        process.stdout.write('\n')
        ok(`Synapse ready — Matrix ${body.versions.at(-1)}`)
        return
      }
    } catch {
      // Not up yet. Schema migrations on a fresh database take a while.
    }
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 2000))
  }
  process.stdout.write('\n')
  fail(`Synapse did not become healthy within ${timeoutMs / 1000}s. Try: yarn matrix:logs`)
}

async function up() {
  requireDocker()
  fs.mkdirSync(SYNAPSE_DIR, { recursive: true })
  fs.mkdirSync(path.join(SYNAPSE_DIR, 'media_store'), { recursive: true })

  const secrets = ensureSecrets()
  ensureSigningKey()
  renderHomeserverConfig(secrets)
  renderRegistration(secrets)
  writeEnvFiles(secrets)
  ok(`config rendered for server_name "${SERVER_NAME}"`)

  step('starting containers')
  // Explicit service names, never a bare `up`: the matrix profile shares a
  // compose project with postgres/redis/meilisearch and must not disturb them.
  const res = dockerCompose(['--profile', 'matrix', 'up', '-d', ...SERVICES])
  if (res.status !== 0) fail('docker compose up failed')

  await waitForHealth()

  log('')
  ok('Matrix stack is up')
  log(`  homeserver   http://127.0.0.1:${SYNAPSE_PORT}`)
  log(`  element      http://127.0.0.1:${ELEMENT_PORT}   (engineering console, dev only)`)
  log(`  server_name  ${SERVER_NAME}`)
  log(`  app env      .matrix-dev/matrix.env`)
  log('')
  log('Next:  yarn matrix:verify')
}

function down() {
  requireDocker()
  step('stopping matrix services')
  // `rm -sf` on named services, never `compose down`, which would take
  // mercato-postgres and every other shared service with it.
  dockerCompose(['--profile', 'matrix', 'rm', '-sf', ...SERVICES])
  ok('stopped (data kept — use yarn matrix:reset to erase)')
}

function reset() {
  requireDocker()
  down()
  step('removing database volume')
  spawnSync('docker', ['volume', 'rm', PG_VOLUME], { stdio: 'ignore' })
  step('removing .matrix-dev/')
  fs.rmSync(DEV_DIR, { recursive: true, force: true })
  ok('reset complete — next yarn matrix:up starts from nothing')
}

async function status() {
  requireDocker()
  const running = docker(['ps', '--format', '{{.Names}}\t{{.Status}}'])
    .split('\n')
    .filter((l) => /mercato-(synapse|element|matrix-postgres)/.test(l))
  if (!running.length) {
    warn('no matrix containers running — yarn matrix:up')
  } else {
    running.forEach((l) => ok(l.replace('\t', '  ')))
  }

  if (!fs.existsSync(SECRETS_FILE)) {
    warn('no .matrix-dev/synapse/secrets.env — nothing has been generated yet')
    return
  }
  const secrets = readEnvFile(SECRETS_FILE)
  log(`  server_name  ${secrets.MATRIX_SERVER_NAME}`)

  try {
    const res = await fetch(`http://127.0.0.1:${SYNAPSE_PORT}/_synapse/admin/v1/server_version`, {
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) log(`  synapse      ${(await res.json()).server_version}`)
  } catch {
    warn('homeserver not answering on the client API')
  }
}

const command = process.argv[2] || 'up'
const handlers = { up, down, reset, status }
if (!handlers[command]) fail(`unknown command "${command}". Use: up | down | reset | status`)
await handlers[command]()
