import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// `eslint-config-next` (and its @typescript-eslint parser) are dependencies of
// the app workspace, which is the only package that runs eslint. During the
// TypeScript 7 migration the app is pinned to JS TypeScript 6 for `next build`
// while the rest of the repo uses native TS 7, so yarn keeps these packages
// nested under apps/mercato instead of hoisting them to the repo root. Resolve
// them from the app directory rather than relative to this root config file, and
// let @typescript-eslint pick up the app's nested JS TypeScript. Simplify back to
// `import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'` once the
// app moves to native TS 7 (Next 16.3).
const require = createRequire(import.meta.url)
const appDir = path.join(import.meta.dirname, 'apps', 'mercato')
const nextCoreWebVitals = (await import(
  pathToFileURL(require.resolve('eslint-config-next/core-web-vitals', { paths: [appDir] })).href
)).default

const ignores = [
  'node_modules/**',
  '.next/**',
  '**/.next/**',
  '.mercato/**',
  '**/.mercato/**',
  'dist/**',
  '**/dist/**',
  'packages/**/dist/**',
  'packages/**/src/**/*.jsx',
  'out/**',
  'build/**',
  'generated/**',
  '**/generated/**',
  'docs/.docusaurus/**',
  'docs/build/**',
  'next-env.d.ts',
  // Agent code-navigation indexes — generated caches, see .ai/docs/code-navigation.md
  'graft/**',
  '**/graphify-out/**',
]

const ruleOverrides = {
  'react/display-name': 'off',

  'react-hooks/immutability': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/static-components': 'off',
}

// Entity decorators come from `@open-mercato/shared/lib/db/decorators` and nowhere else.
// The shim pins the TC39 (Stage-3) flavour — which is what lets both Next minifiers stay on
// (apps/mercato/next.config.ts) — and patches two upstream defects in
// `@mikro-orm/decorators@7`: a subclass's `@Index`/`@Unique` mutating the PARENT entity's
// metadata, and an explicit column `name:` being dropped so the column silently takes the
// property's name instead. Both fail quietly, as schema drift rather than as an error, so
// importing upstream directly is worth catching at the keystroke.
//
// `turbo run lint` only runs in apps/mercato, so in CI this covers that workspace alone;
// editors resolve this config for `packages/**` too. The gate that covers every entity file
// is packages/shared/src/lib/db/__tests__/entity-decorator-boundary.test.ts, which runs under
// `yarn test`.
const entityDecoratorImports = {
  name: 'project/entity-decorator-shim',
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['@mikro-orm/decorators', '@mikro-orm/decorators/*'],
        message:
          'Import entity decorators from @open-mercato/shared/lib/db/decorators. Importing '
          + '@mikro-orm/decorators directly skips the TC39 pin and the @Index/@Unique + column-name '
          + 'fixes, which fail silently as schema drift.',
      }],
    }],
  },
}

// The shim is the one place allowed to reach upstream — it is what re-exports it.
const entityDecoratorShimItself = {
  name: 'project/entity-decorator-shim-allowlist',
  files: ['packages/shared/src/lib/db/decorators.ts'],
  rules: { 'no-restricted-imports': 'off' },
}

export default [
  ...nextCoreWebVitals,
  { ignores },
  { name: 'project/rule-overrides', rules: ruleOverrides },
  entityDecoratorImports,
  entityDecoratorShimItself,
]
