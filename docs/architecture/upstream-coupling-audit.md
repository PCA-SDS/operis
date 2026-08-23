# Upstream Coupling Audit

Audit of everything binding Operis to Open Mercato, performed at the fork point
(upstream `3019dc23`, v0.7.0) on 2026-08-23.

Classification scheme:

| # | Class |
|---|---|
| 1 | Core architecture worth retaining |
| 2 | Third-party dependency |
| 3 | OpenMercato-specific but useful |
| 4 | OpenMercato-specific and unnecessary |
| 5 | Upstream compatibility mechanism |
| 6 | Legacy/stale |
| 7 | Unknown — needs investigation |

## Resolved

| Item | Class | Disposition |
|---|---|---|
| `packages/enterprise/` | 4 (licensing) | **Excluded.** Commercial license. [ADR-0002](adr/ADR-0002-exclude-enterprise-edition.md) |
| `.ai/specs/enterprise/`, `apps/docs/docs/enterprise/`, EE analysis + run log | 4 (licensing) | **Excluded.** Restricted specs; retaining them invites derivation |
| Enterprise module registration (`OM_ENABLE_ENTERPRISE_MODULES*`) | 5 | **Removed** from `apps/mercato/src/modules.ts` and the create-app template |
| Enterprise `COPY` lines in `Dockerfile` (×6) | 6 | **Removed** — would have failed the Docker build |
| Enterprise Jest `moduleNameMapper` entries | 6 | **Removed** |
| Enterprise entries in coverage allowlists / scan roots | 6 | **Removed** — a stale-allowlist guard was correctly failing on them |
| `PLATFORM_DOMAINS` default `localhost,openmercato.com` | 4 | **Changed** to `localhost`. [ADR-0003](adr/ADR-0003-platform-domains-default.md) |
| README "Release Channels" advising `yarn add @open-mercato/core@develop` | 5 | **Replaced.** Following it would pull upstream's published packages into the fork |
| README identity / marketing / EE upsell | 4 | **Replaced** with Operis identity + provenance |
| `.ai/specs/LICENSE.md`, `.ai/specs/AGENTS.md`, root `AGENTS.md` EE references | 6 | **Updated** — they instructed developers to consult directories that no longer exist |
| `packages/telemetry` | 2 | **Retained.** Plain OpenTelemetry/OTLP configured by standard env vars. Verified: **no phone-home** to Open Mercato. (The usage-telemetry phone-home spec was an *enterprise* spec and was excluded.) |
| `.yarnrc.yml` `enableTelemetry: false` | 1 | Retained — already disabled |
| `certs/geotrust-ev-rsa-ca-g2.pem` | 2 | Retained; third-party CA cert, noted in `NOTICE.md` |
| `scripts/clean-packages.sh` deleting a **source-controlled** test fixture | 6 (upstream bug) | **Fixed.** `find … -name dist` matched `packages/cli/src/lib/__fixtures__/official-module-package/dist/`; `yarn clean` silently broke the CLI suite. Added a `__fixtures__` prune |
| `scripts/clean-generated.sh` dead `-path 'dist'` prune | 6 (upstream bug) | **Removed.** The pattern could never match, so the line was a no-op while the script claimed it cleaned `dist/` |
| Duplicate `hasAllFeatures` with **reversed** argument order | 6 | **Consolidated.** `security/features` now delegates to `lib/auth/featureMatch`; both import paths and call conventions preserved, pinned by a new mutation-tested guard |
| `create-app` `module-facts-build.test.ts` asserting on the enterprise `security` module | 6 | **Fixed.** Same enterprise-removal casualty already fixed in the CLI copy; this one only surfaced once `create-mercato-app` tests ran to completion |
| `mercato auth setup --roles` silently minting a **global** super-admin | 7 → documented | **Warning added** (semantics unchanged — `auth/AGENTS.md` marks super-admin behavior "ask first"). See [multi-tenancy.md § 6](multi-tenancy.md) |

## Retained deliberately

| Item | Class | Reasoning |
|---|---|---|
| `@open-mercato/*` package scope | 3 | Renaming ~9,000 files to `@operis/*` is a large mechanical diff with no technical benefit today. All deps are `workspace:*`, so upstream packages are never silently resolved. Revisit only if Operis publishes packages. [ADR-0001](adr/ADR-0001-fork-from-open-mercato.md) |
| Query engine, RBAC, directory module, DI, commands, events, cache | 1 | The reason to fork this codebase at all |
| `.ai/` harness (specs, skills, lessons, review checklist) | 3 | All MIT. Genuinely useful working conventions |
| `packages/create-app` | 3/5 | Scaffolds standalone apps against **published** packages — an upstream distribution mechanism Operis does not use. Left in place because it is self-contained, tested, and removing it is unnecessary churn. **Candidate for removal** once confirmed unused |
| `official-modules.json` + `scripts/official-modules.mjs` | 5 | Generic git-clone module loader, but the default repo is `open-mercato/official-modules`. Currently **inert** (`available: []`, `activated: []`, no `external/` directory). Activating an official module reintroduces upstream code — treat as a deliberate decision, not a routine one |
| `docs.openmercato.com` links in UI/docs | 3 | Upstream docs remain the only documentation for much inherited behaviour. Relabelled in the README as historical reference. Replace as Operis documentation is written |
| `demo.openmercato.com` in test fixtures | 6 (benign) | Arbitrary hostnames in test data; no runtime effect. Not worth churn |

## Known consequence: `create-app` git-provenance gates cannot pass

`packages/create-app` ships harness gates that pin **upstream git commit SHAs** and read
file content at those commits:

```js
// packages/create-app/scripts/validate-source-links.mjs
runGit(['fetch', '--no-tags', '--depth=1', 'origin', sha])
```

Verified 2026-08-23: the pinned SHAs (`f7c94157…`, `bf25803d…`, `b2d26489…`) are genuine
Open Mercato commits, are **absent** from this repository's object store, and are not
reachable from our `origin` (`github.com/f4heemmmmm/operis.git`). This repo currently has
one commit, `dc6fa04 Initial commit`, because the fork was imported as a working tree
without upstream history — see [ADR-0001](adr/ADR-0001-fork-from-open-mercato.md).

**Result: 10 assertions in `create-mercato-app` fail.** They are the provenance gates
themselves reporting, correctly and fail-closed, that this tree cannot substantiate the
baselines it claims. Upstream runs the same suite green (867 tests, 0 fail), so this is
a property of the fork, not a code defect. Every other package is unaffected.

Failing assertions:

- `the checked design-system inventory is exactly what the generator derives`
- `gallery and foundation baselines must be ancestors of the generated inventory`
- `the pinned baseline assets still hash and parse exactly as the specification table says`
- `the checked ledger and topic registry validate as shipped`
- 6 negative-path tests in `source-link-baseline.test.ts` that depend on the same fixture

### How to resolve (requires a decision)

| Option | Action | Notes |
|---|---|---|
| **Re-baseline** | Commit the fork, then `yarn workspace create-mercato-app harness:generate-source-link-inventory` and `harness:generate-design-system-inventory` | Repins provenance to *our* history. The intended long-term fix |
| **Make upstream objects reachable** | `git remote add upstream https://github.com/open-mercato/open-mercato.git && git fetch upstream`, and point the gate at that remote | Re-introduces an upstream dependency the fork exists to remove |
| **Drop `create-app`** | Remove the package | It scaffolds apps against **published** `@open-mercato/*` npm packages — a distribution mechanism Operis does not use (see the retained-deliberately table above). Removes the gates and ~10% of the test surface with them |

Neither of the first two was done here: committing and modifying remote configuration are
both outside what this work was authorized to do.

## Open items

| Item | Class | Note |
|---|---|---|
| Legal/imprint content naming "Open Mercato sp. z o.o." | 7 | `packages/content` renders legal pages naming upstream's legal entity, and `apps/docs/cla.md` is upstream's contributor licence agreement. **These are wrong for Operis but the correct replacement is a business decision** (which legal entity operates Operis). Guarded by `packages/content/src/__tests__/legal-entity.test.tsx` |
| `apps/mercato/public/open-mercato.svg` + branding assets | 3 | Product branding still upstream's. Cosmetic; replace when Operis has its own |
| `newrelic.js`, `railway.toml`, `.devcontainer`, `docker-compose.*` | 7 | Deployment configs carried over verbatim. Harmless but unverified against Operis's actual deployment target |

## Verification

Re-verified end-to-end on 2026-08-23 from a **fully clean tree** (`yarn clean` →
`yarn install` → generate → build):

| Check | Result |
|---|---|
| `yarn install` (after full `yarn clean`) | pass |
| `yarn build:packages` | pass — 24/24 |
| `yarn generate` | pass — and **deterministic** (412 generated files, byte-identical checksums on re-run) |
| `yarn typecheck` | pass — 24/24, zero errors |
| `yarn lint` | pass — zero errors |
| `yarn test` (jest, all packages) | **20,448 passed / 0 failed** |
| `yarn test` (`create-mercato-app`, node:test) | 867 tests — 852 pass, **10 fail**, 5 skipped — all 10 are the git-provenance gates above |
| `yarn build` (production) | **pass** — Next.js production build, all routes compiled |
| Migrations: empty DB → chain | pass — 292 tables |
| Migrations: both paths converge | pass — 3,792 columns and 535 constraints **identical** to the incrementally-migrated DB |
| Migrations: idempotent re-run | pass — 45 modules "no pending", 0 applied |
| `yarn initialize` | pass — tenant + org tree + roles + users provisioned |
| App startup | pass — `/login` serves 200 |
| Authentication | pass — valid credentials return JWT + session; invalid → 401; **session invalidated after logout** (401) |
| Authorization | pass — protected API 401 without session, 200 with |
| Cross-tenant isolation | pass — see [multi-tenancy.md § 6a](multi-tenancy.md) for the full attack matrix |
| Optimistic locking | pass — stale-version write → **409** `optimistic_lock_conflict`; no-header write is the documented opt-out |
| Error handling | pass — unknown route 404, malformed input 400 with structured zod errors, **no stack traces or SQL in bodies** |
| Production secret policy | pass — `NODE_ENV=production` **throws** on placeholder and on <32-char secrets, accepts strong ones |

**Known test-run flakiness (environmental, not a code defect).** Running the suite at
the default concurrency on this machine intermittently loses one suite to a
`SIGSEGV`-killed Jest worker — observed on five different suites across five runs, each
time with **0 failed tests** in the package's own counter, and each affected suite
passing in isolation. Running `npx turbo run test --concurrency=1` with
`NODE_OPTIONS=--max-old-space-size=4096` is stable and is how the numbers above were
produced. Do not chase these as real failures.

An integrity check compared the 12,365 files tracked upstream against the fork:
**458 are absent, and every one falls under a documented exclusion above.** No
collateral loss.

One file was initially lost by an over-broad `--exclude=dist/` during import —
`packages/cli/src/lib/__fixtures__/official-module-package/dist/modules/test_package/index.js`,
a *checked-in test fixture* rather than a build artifact. It was restored, and the
integrity check above exists to catch that class of mistake.
