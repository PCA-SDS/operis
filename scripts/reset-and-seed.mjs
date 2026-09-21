#!/usr/bin/env node
/**
 * Wipe the local database and re-seed the canonical development topology.
 *
 * This is the "give me a clean slate" command for a developer workstation. It
 * drops every table at DATABASE_URL, re-applies all module migrations, then runs
 * the idempotent development seed, leaving exactly the accounts declared in
 * `DEV_SEED_TENANTS` (packages/core/src/modules/auth/lib/seed-dev.ts) and no
 * customer, deal or company data at all.
 *
 * Usage:
 *   node scripts/reset-and-seed.mjs            # analyse, then ask before wiping
 *   node scripts/reset-and-seed.mjs --yes      # analyse and wipe without asking
 *   node scripts/reset-and-seed.mjs --dry-run  # analyse only, change nothing
 *   node scripts/reset-and-seed.mjs --build    # build packages / generate first
 *
 * Environment:
 *   DATABASE_URL           read from apps/mercato/.env unless already exported
 *   OM_DEV_SEED_PASSWORD   overrides the seeded password (default: Operis!23)
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = path.join(REPO_ROOT, 'apps', 'mercato')
const CLI_BIN = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'bin.js')
const GENERATED_MARKER = path.join(APP_DIR, '.mercato', 'generated', 'modules.generated.ts')

/**
 * Tables emptied by the wipe that an operator actually cares about seeing a
 * count for. Deliberately a short, readable list rather than all ~350 tables:
 * it exists to prove "the clients and users are gone", not to audit the schema.
 */
const REPORTED_TABLES = [
  'tenants',
  'organizations',
  'users',
  'roles',
  'user_roles',
  'customer_entities',
  'customer_people',
  'customer_companies',
  'customer_deals',
  'customer_users',
]

export function parseArgs(argv) {
  return {
    yes: argv.includes('--yes') || argv.includes('-y'),
    dryRun: argv.includes('--dry-run'),
    build: argv.includes('--build'),
    force: argv.includes('--force'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

/**
 * Renders a connection string as host:port/database, never echoing the
 * credentials embedded in it. Returns null for input that is not a URL so the
 * caller can fall back to a generic label rather than printing a raw secret.
 */
export function describeDatabaseUrl(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`
  } catch {
    return null
  }
}

/**
 * True when the target looks like a developer workstation database. Used only
 * to decide whether to demand an extra confirmation — never to allow a wipe
 * that was not already requested.
 */
export function looksLocal(url) {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === 'postgres'
  } catch {
    return false
  }
}

function loadEnv() {
  const envPath = path.join(APP_DIR, '.env')
  if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key] !== undefined) continue
      process.env[key] = rawValue.trim().replace(/^["'](.*)["']$/, '$1')
    }
  }
  return process.env.DATABASE_URL ?? null
}

async function analyse(databaseUrl) {
  let Client
  try {
    ;({ Client } = await import('pg'))
  } catch {
    console.log('  (pg module unavailable — skipping the row-count report)\n')
    return null
  }

  const client = new Client({ connectionString: databaseUrl })
  try {
    await client.connect()
  } catch (error) {
    console.log(`  Could not connect: ${error.message}`)
    console.log('  Is PostgreSQL running?  docker compose up -d postgres redis\n')
    return null
  }

  try {
    const { rows: tableRows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`,
    )
    const present = new Set(tableRows.map((row) => row.tablename))
    if (!present.size) {
      console.log('  The schema is empty — nothing to wipe.\n')
      return { tables: 0, counts: {}, tenants: [] }
    }

    const counts = {}
    for (const table of REPORTED_TABLES) {
      if (!present.has(table)) continue
      const { rows } = await client.query(`SELECT count(*)::int AS total FROM "${table}"`)
      counts[table] = rows[0].total
    }

    let tenants = []
    if (present.has('tenants')) {
      const { rows } = await client.query(`SELECT name FROM tenants ORDER BY name`)
      tenants = rows.map((row) => row.name)
    }

    console.log(`  ${present.size} tables in the schema\n`)
    const width = Math.max(...Object.keys(counts).map((key) => key.length), 0)
    for (const [table, total] of Object.entries(counts)) {
      console.log(`    ${table.padEnd(width)}  ${String(total).padStart(6)}`)
    }
    if (tenants.length) console.log(`\n  Existing tenants: ${tenants.join(', ')}`)
    // User emails are encrypted at rest (TENANT_DATA_ENCRYPTION), so a raw SQL
    // report can count identities but never name them.
    console.log('\n  Note: user emails are encrypted at rest and cannot be listed here.\n')
    return { tables: present.size, counts, tenants }
  } finally {
    await client.end().catch(() => {})
  }
}

function run(args, label) {
  console.log(`\n▶ ${label}`)
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'null'}`)
  }
}

function runYarn(script, label) {
  console.log(`\n▶ ${label}`)
  const result = spawnSync('yarn', [script], { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'null'}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''))
    return 0
  }

  if (process.env.NODE_ENV === 'production' && !options.force) {
    console.error('✖ Refusing to run with NODE_ENV=production. This deletes every row in the database.')
    return 1
  }

  const databaseUrl = loadEnv()
  if (!databaseUrl) {
    console.error('✖ DATABASE_URL is not set and apps/mercato/.env does not define it.')
    console.error('  Copy the template first:  cp apps/mercato/.env.example apps/mercato/.env')
    return 1
  }

  const target = describeDatabaseUrl(databaseUrl) ?? 'the configured database'
  console.log('\n═══ Current database ═══\n')
  console.log(`  Target: ${target}\n`)
  await analyse(databaseUrl)

  if (options.dryRun) {
    console.log('--dry-run: nothing was changed.')
    return 0
  }

  if (options.build) {
    runYarn('build:packages', 'Building workspace packages')
    runYarn('generate', 'Running module generators')
  }

  if (!fs.existsSync(CLI_BIN)) {
    console.error(`✖ The CLI is not built (${path.relative(REPO_ROOT, CLI_BIN)} is missing).`)
    console.error('  Run:  yarn build:packages    (or re-run this script with --build)')
    return 1
  }
  if (!fs.existsSync(GENERATED_MARKER)) {
    console.error(`✖ Module registries are not generated (${path.relative(REPO_ROOT, GENERATED_MARKER)} is missing).`)
    console.error('  Run:  yarn generate    (or re-run this script with --build)')
    return 1
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error('✖ Refusing to wipe without confirmation. Re-run with --yes in a non-interactive shell.')
      return 1
    }
    console.log('This DROPS EVERY TABLE at the target above and re-creates them from migrations.')
    console.log('Every user, customer, company and deal is deleted. This cannot be undone.\n')
    if (!looksLocal(databaseUrl)) {
      console.log('⚠  The target does not look like a local database. Be certain before continuing.\n')
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question("Type 'wipe' to continue: ")
    rl.close()
    if (answer.trim() !== 'wipe') {
      console.log('Aborted — nothing was changed.')
      return 1
    }
  }

  run([CLI_BIN, 'db', 'reset', '--yes'], 'Dropping every table and re-applying migrations')
  run([CLI_BIN, 'seed:dev'], 'Seeding the development topology')

  console.log('\n═══ Result ═══\n')
  await analyse(databaseUrl)
  console.log('✅ Clean slate seeded. Sign in at http://localhost:3000/login\n')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      console.error(`\n✖ ${error.message}`)
      process.exitCode = 1
    })
}
