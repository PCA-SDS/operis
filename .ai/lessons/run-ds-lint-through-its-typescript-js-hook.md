---
title: "Run lint:ds through its typescript-js hook, not bare eslint"
modules: ["design_system"]
areas: ["testing","debugging"]
topics: ["design-system","lint","typescript"]
---

# Run lint:ds through its typescript-js hook, not bare eslint

**Context**: Verifying design-system compliance on a change, an agent invoked
`npx eslint -c eslint.ds.config.mjs <paths>` directly instead of `yarn lint:ds`.

**Problem**: It failed with `typescript-eslint does not support TS 7.0` and was
reported as "lint:ds cannot run in this checkout" — a false claim that hid the
DS ruleset from the change's verification. The repo pins `typescript@7.0.2`,
which `@typescript-eslint/parser@8` refuses, but it also ships
`typescript-js: npm:typescript@6.0.3` plus `scripts/typescript-js-require-hook.cjs`.
The `lint:ds` script preloads that hook (`node --require …`) so the parser
resolves TS 6 and the config parses normally. Bare `eslint` skips the hook.

**Rule**: Run design-system lint as `yarn lint:ds`. Do not invoke `eslint` with
`eslint.ds.config.mjs` directly, and do not conclude the ruleset is unrunnable
from a TS-version parser error — check for the require hook in the script first.
All `om-ds/*` rules are `warn` during rollout, so a clean run reports
`0 errors, N warnings`; compare N against the pre-change baseline rather than
expecting zero.

**Applies to**: `package.json` (`lint:ds`), `eslint.ds.config.mjs`,
`scripts/typescript-js-require-hook.cjs`, and any agent skill that verifies DS
compliance.
