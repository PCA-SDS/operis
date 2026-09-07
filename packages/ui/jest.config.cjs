/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

const transformer = [
  '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
  {
    tsconfig: {
      jsx: 'react-jsx',
      rootDir: '.',
      ignoreDeprecations: '6.0',
    },
  },
]

// Jest does not interpolate `<rootDir>` in transform *keys* (only in the transformer
// path), so the repo's own `scripts/*.cjs` emitters are selected by requiring a
// `scripts/` segment and excluding `node_modules` outright — third-party `.cjs` inside
// the allowlisted ESM packages stays untransformed.
const SCRIPTS_CJS_PATTERN = '^(?!.*[\\\\/]node_modules[\\\\/]).*[\\\\/]scripts[\\\\/].+\\.cjs$'

module.exports = {
  ...base,
  testEnvironment: 'jsdom',
  testTimeout: 30000,
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@open-mercato/ui/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/../core/src/$1',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^react-markdown$': '<rootDir>/jest.markdown-mock.tsx',
    '^remark-gfm$': '<rootDir>/jest.markdown-mock.tsx',
  },
  transform: {
    '^.+\\.(t|j)sx?$': transformer,
    // Keeps the build-time source emitters under scripts/ testable.
    [SCRIPTS_CJS_PATTERN]: transformer,
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // sanitize-html 2.17.7 moved to htmlparser2 v12, which is ESM-only (no
  // `require` export condition). Node 24 can require() it; jest's module
  // runtime cannot, so these are transformed instead of ignored.
  //
  // `sanitize-html` itself is listed on purpose. The module resolves to
  // node_modules/sanitize-html/node_modules/htmlparser2/, and this regex matches
  // at the FIRST `node_modules/`; without the sanitize-html entry the negative
  // lookahead succeeds there and the nested file stays ignored no matter what
  // else is allowlisted.
  transformIgnorePatterns: [
    'node_modules/(?!(@mikro-orm|kysely|ai|@ai-sdk|ai-sdk-ollama|@workflow|@standard-schema|@tanstack/react-table|@tanstack/table-core|@tanstack/react-store|@tanstack/store|sanitize-html|htmlparser2|domhandler|domutils|domelementtype|dom-serializer|entities)/)',
  ],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)',
    '<rootDir>/__integration__/**/*.spec.(ts|tsx)',
  ],
  passWithNoTests: true,
}
