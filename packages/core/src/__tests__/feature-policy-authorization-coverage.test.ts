import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import fg from 'fast-glob'

const repoRoot = resolve(__dirname, '../../../..')

// Every package that ships server-side modules. The list was previously five
// roots, which left 13 module-shipping packages unscanned — a violation in
// checkout or any channel package would not have been caught. Keep this in sync
// when a package gains src/modules; the guard is only as wide as this list.
const serverRuntimeRoots = [
  'apps/mercato/src/app',
  'packages/core/src/modules',
  'packages/ai-assistant/src/modules',
  'packages/search/src/modules',
  'packages/webhooks/src/modules',
  'packages/checkout/src/modules',
  'packages/scheduler/src/modules',
  'packages/storage-s3/src/modules',
  'packages/onboarding/src/modules',
  'packages/content/src/modules',
  'packages/sync-akeneo/src/modules',
  'packages/gateway-stripe/src/modules',
  'packages/channel-apns/src/modules',
  'packages/channel-expo/src/modules',
  'packages/channel-fcm/src/modules',
  'packages/channel-gmail/src/modules',
  'packages/channel-imap/src/modules',
  'packages/events/src/modules',
]

const sharedAuthorizationRunners = [
  'packages/shared/src/lib/commands/command-interceptor-runner.ts',
  'packages/shared/src/lib/crud/interceptor-runner.ts',
  'packages/shared/src/lib/crud/mutation-guard-registry.ts',
  'packages/shared/src/lib/crud/enricher-runner.ts',
]

const lowLevelMatcherAllowlist = new Set([
  // Realm services are the only persistence-aware authorization entrypoints.
  'packages/core/src/modules/auth/services/rbacService.ts',
  'packages/core/src/modules/customer_accounts/services/customerRbacService.ts',
  // Grant-management validation compares proposed role grants, not a live subject.
  'packages/core/src/modules/auth/lib/grantChecks.ts',
  // Static tool-route contract validation, not a user authorization decision.
  'packages/ai-assistant/src/modules/ai_assistant/lib/ai-api-operation-runner.ts',
])

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/')
    || path.endsWith('.test.ts')
    || path.endsWith('.test.tsx')
    || path.endsWith('.spec.ts')
    || path.endsWith('.spec.tsx')
}

function skipLeadingWhitespaceAndComments(source: string): number {
  let offset = 0

  while (offset < source.length) {
    while (offset < source.length && source[offset].trim() === '') offset += 1

    if (source.startsWith('//', offset)) {
      const newline = source.indexOf('\n', offset + 2)
      offset = newline === -1 ? source.length : newline + 1
      continue
    }

    if (source.startsWith('/*', offset)) {
      const commentEnd = source.indexOf('*/', offset + 2)
      offset = commentEnd === -1 ? source.length : commentEnd + 2
      continue
    }

    break
  }

  return offset
}

function isBrowserFile(path: string, source: string): boolean {
  const directiveOffset = skipLeadingWhitespaceAndComments(source)
  const startsWithClientDirective = source.startsWith("'use client'", directiveOffset)
    || source.startsWith('"use client"', directiveOffset)
  return startsWithClientDirective
    || path.includes('/components/')
    || path.includes('/widgets/injection/')
    || path.endsWith('.client.ts')
    || path.endsWith('.client.tsx')
}

describe('server feature-policy authorization coverage', () => {
  it('does not authorize live subjects with low-level ACL matchers', async () => {
    const files = await fg(
      [
        ...serverRuntimeRoots.map((root) => `${root}/**/*.{ts,tsx}`),
        ...sharedAuthorizationRunners,
      ],
      { cwd: repoRoot, absolute: true },
    )
    const violations: string[] = []

    for (const file of files) {
      const path = relative(repoRoot, file).replaceAll('\\', '/')
      if (isTestFile(path)) continue

      const source = readFileSync(file, 'utf8')
      if (isBrowserFile(path, source) || lowLevelMatcherAllowlist.has(path)) continue

      const importsLowLevelMatcher = /@open-mercato\/shared\/security\/features/.test(source)
        || /(?:lib\/auth\/featureMatch|customer_accounts\/lib\/featureMatch)/.test(source)
      const matchesLoadedAclDirectly = /\bloadAcl\s*\(/.test(source) && (
        /\b(?:hasFeature|hasAllFeatures|matchFeature)\s*\(/.test(source)
        || /\.features\s*\.includes\s*\(/.test(source)
      )
      const locallyOrdersAdminAndGrants = /\bisSuperAdmin\b/.test(source)
        && (
          /\.features\s*\.includes\s*\(/.test(source)
          || /\b(?:userFeatures|grantedFeatures|resolvedFeatures|authFeatures)\s*\.(?:includes|some|every)\s*\(/.test(source)
        )

      if (importsLowLevelMatcher || matchesLoadedAclDirectly || locallyOrdersAdminAndGrants) {
        violations.push(path)
      }
    }

    expect(violations).toEqual([])
  })
})
