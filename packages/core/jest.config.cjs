/** @type {import('jest').Config} */
const base = require('../../jest.config.base.cjs')

module.exports = {
  ...base,
  testEnvironment: 'node',
  testTimeout: 30000,
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^#generated/entities\\.ids\\.generated$': '<rootDir>/jest.mocks/entities.ids.generated.js',
    '^#generated/(.*)$': '<rootDir>/generated/$1',
    '^@open-mercato/core/generated/entities\\.ids\\.generated$': '<rootDir>/jest.mocks/entities.ids.generated.js',
    '^@open-mercato/core/generated/(.*)$': '<rootDir>/generated/$1',
    '^@open-mercato/core/(.*)$': '<rootDir>/src/$1',
    '^@open-mercato/cache$': '<rootDir>/../cache/src/index.ts',
    '^@open-mercato/cache/(.*)$': '<rootDir>/../cache/src/$1',
    '^@open-mercato/queue/worker$': '<rootDir>/../queue/src/worker/runner.ts',
    '^@open-mercato/queue/(.*)$': '<rootDir>/../queue/src/$1',
    '^@open-mercato/queue$': '<rootDir>/../queue/src/index.ts',
    '^@open-mercato/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@open-mercato/ui/(.*)$': '<rootDir>/../ui/src/$1',
    '^@open-mercato/ai-assistant/(.*)$': '<rootDir>/../ai-assistant/src/$1',
    '^@/\\.mercato/generated/inbox-actions\\.generated$': '<rootDir>/jest.mocks/inbox-actions.generated.js',
    '^react-markdown$': '<rootDir>/jest.mocks/react-markdown.js',
    '^remark-gfm$': '<rootDir>/jest.mocks/remark-gfm.js',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs',
      {
        tsconfig: {
          jsx: 'react-jsx',
          rootDir: '.',
          ignoreDeprecations: '6.0',
        },
      },
    ],
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
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)'],
  passWithNoTests: true,
}
