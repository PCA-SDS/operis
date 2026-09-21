# ADR-0007 — Enforce module boundaries with the package exports map

- **Status:** Accepted
- **Date:** 2026-09-17

## Context

`docs/architecture/modular-monolith-audit-2026-09-17.md` measured the module
graph and found that of **1,306 production import edges from one business
module into another, 1,301 (99.6%) reach directly into the target's internals**
— `lib/`, `data/entities`, `services/`, `utils/`, `components/`. **Zero** go
through the target's `index.ts`.

That is not a discipline failure. Every module's `index.ts` is a 6–37 line
descriptor exporting `metadata` and `features`, so a module that wants to
integrate correctly has nothing to import. Even `chat_tasks` — written
deliberately as an integration seam, declaring `requires: ['chat', 'tasks']` and
documenting that it "owns no task rules of its own" — still breaches `tasks`'
internals six ways, because no alternative surface exists.

The contract mechanisms that do exist (command bus, events, query engine, widget
injection, DI) are real and well used: 335 command-bus call sites, a clean
acyclic event graph, 297 tables with unambiguous single owners. They are simply
*optional*, sitting beside an unrestricted direct-import path that nothing
prefers against.

Two mechanisms actively defeated enforcement:

1. `packages/core/package.json` curated ~25 deliberate public subpaths and then
   added a wildcard ladder (`./*/*`, `./*/*/*`, … ten levels deep) that made
   every file under `src/` importable. The curated list documented an intent the
   export map itself overrode.
2. ESLint carried exactly one `no-restricted-imports` rule (the MikroORM
   decorator shim), and `turbo run lint` only runs in `apps/mercato`, so
   `packages/**` was editor-only.

## Decision

**Seal each module behind its package `exports` map, one module at a time.**

A sealed module maps `./modules/<id>/*` to `null` and publishes only
`./modules/<id>` (its descriptor) and `./modules/<id>/contract`. Node,
TypeScript, webpack and Turbopack all honour `exports`, so a cross-module deep
import **fails to resolve at compile time**:

```
src/modules/staff/probe.ts(1,25): error TS2307:
  Cannot find module '@open-mercato/core/modules/invoice/data/entities'
```

Three supporting decisions make that workable:

**The composition root gets its own door.** The generated registry legitimately
imports every module's `api/`, `backend/`, `subscribers/`, `workers/` and
`data/` — 11,611 such imports. That is exactly the access a seal denies to
hand-written code, so it is split onto a reserved subpath: `getModuleImportBase`
(`packages/cli/src/lib/resolver.ts`) now emits
`@open-mercato/<pkg>/internal/modules/<id>/…`, and `./internal/*` stays
permanently open. A guard asserts the prefix appears only in generated output,
so the exemption is structural, not an allowlist.

**Cross-module reads go through the query engine.** A module's `contract.ts`
publishes query-engine entity ids rather than exporting entity classes or read
functions. The engine appends tenant/organization predicates and throws without
a `tenantId`, so a cross-module read is tenant-safe by construction. This
directly narrows the gap the audit found, where 1,859 direct `em.*` calls bypass
that guarantee.

**Contracts start empty.** A contract declares addresses — command ids, read
models, DI tokens — not implementations, and only ones a real caller needs
today. Publishing every command a module happens to own would re-create the wide
surface sealing removes, except sanctioned.

## Rejected alternatives

**Per-module workspace packages** (47 × `package.json`). The strongest possible
boundary, and it would make dependencies and cycles visible to the package
manager. Rejected because the probe proved a single package's `exports` map
already delivers per-module encapsulation, while this would require rewriting
every import path in the repo and changing the auto-discovery contract that
scans `packages/core/src/modules/*`. Kept as a later option: `contract.ts` is
identical either way.

**A count-based ratchet** ("no more than 1,301 violations"). Rejected as the
first draft of this plan and explicitly overruled. A ratchet freezes debt and
reports it as progress — 1,301 violations could live forever provided nobody
adds the 1,302nd. Sealing is per-module and binary: a module reaches zero and
stays there.

**ESLint `no-restricted-imports`.** Kept in reserve for the 186 relative-path
escapes, but rejected as the primary boundary: it is a warning a developer can
silence, it does not run over `packages/**` in CI today, and it is weaker than a
mechanism the module resolver already enforces.

## Consequences

**Enforced, no baseline.** `module-seal-integrity.test.ts` and
`module-contract-purity.test.ts` run in the existing repo-wide guard harness.
The forcing rule — *a module with no remaining deep importers MUST be sealed* —
means the seal follows the code: the moment a module's last deep importer is
migrated, CI requires it to be sealed, and it cannot drift back. There is no
hand-maintained number to argue about.

**20 modules sealed on day one** at zero migration cost, because nothing
imported their internals: `chat_tasks`, `perspectives`, `warranty_claims`,
`wms`, `portal`, `invoice`, `email`, `chat_matrix`, `design_system`, `eudr`,
`sync_excel`, the five `channel-*` packages, `content`, `events`, `onboarding`,
`sync_akeneo`.

**Remaining work is caller migration, not plumbing.** Sealing order is driven by
external caller count: `tasks` (1), `chat` (3), `staff` (3), `planner` (4) …
`notifications` (24), `auth` (30), `directory` (44). The platform hubs come last,
and moving misplaced platform code (`organizationScope`, `tenantAccess`) down
into `shared` first shrinks those counts before they are attempted.

**`packages/shared/src/modules/*` is out of scope** — those are the platform's
shared contract namespaces (`registry`, `events`, `widgets`, `setup`) that every
module is supposed to import, and none owns a table.

**One build subtlety is load-bearing.** `packages/core/build.mjs` sets
`copyJsonIgnore: ['**/i18n/**']`, so locale dictionaries never reach `dist`. A
sealed module's `i18n/*.json` therefore keeps an explicit exports entry pointing
at `src/`, and `scripts/seal-module.mjs` refuses to rewrite those imports to
relative paths — doing so typechecks against `src` and then fails the Turbopack
build against `dist`.

## Verification

`yarn generate`, `yarn build:packages`, `yarn typecheck` (26/26), `yarn lint`
(0 errors), `yarn test`, `yarn build:app` and `yarn test:repo-wide-guards`
(42 files) all pass. Boundary liveness was proven by negative probe, in both
directions:

```
@open-mercato/core/modules/wms/data/entities                  -> TS2307 blocked
@open-mercato/onboarding/modules/onboarding/data/entities     -> TS2307 blocked
@open-mercato/core/modules/invoice/contract                   -> resolves
```

Related: `docs/architecture/modular-monolith-audit-2026-09-17.md`,
[ADR-0004](ADR-0004-compatibility-scope.md) (why import paths are internal in
this fork and may be narrowed without a deprecation window).
