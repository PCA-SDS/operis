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

## Independence audit — 2026-08-23 (second pass)

A focused audit of whether Open Mercato remains a *constraint* rather than an
origin. Findings and dispositions:

| Finding | Class | Disposition |
|---|---|---|
| `BACKWARD_COMPATIBILITY.md` froze 14 contract-surface categories — exports, signatures, import paths, DI keys, CLI commands, widget spot IDs — because *"third-party developers depend on stable platform APIs"*, and `AGENTS.md` made it binding | 3 → **the real constraint** | **Re-scoped.** Operis publishes nothing; the freeze now covers only identifiers **written into the database**. [ADR-0004](adr/ADR-0004-compatibility-scope.md) |
| 24 package manifests declared `repository.url` = upstream's GitHub with `publishConfig.access: public` | 4 | **Repointed** to this repository. (`access: public` left alone — see open items) |
| `official-modules` defaulted to cloning `open-mercato/official-modules`, wired into `postinstall` | 5 | **Neutralized.** Default repo is now empty and activation without an explicit repo fails with a clear message instead of silently fetching from upstream. The postinstall was already a no-op when nothing is activated |
| API docs footer rendered `© Open Mercato. All rights reserved.` and linked to openmercato.com privacy + terms, shown to *our* API consumers | 4 (product/legal) | **Made configurable** — `OM_BRAND_NAME`, `OM_PRIVACY_URL`, `OM_TERMS_URL`, `OM_API_DOCS_URL`. Brand falls back to the OpenAPI title; legal links render only when set |

Verified clean, no action needed:

- **No update notifier or version check.** Nothing polls npm or GitHub for a newer Open Mercato.
- **No runtime dependency.** Every `@open-mercato/*` dep resolves `workspace:*`; no manifest pulls one from a registry.
- **No license or entitlement gate** tied to upstream.
- **No submodules**, and no CI workflow references an upstream repo or registry.
- **`BACKWARD_COMPATIBILITY.md` was never machine-enforced** — referenced only in comments, so nothing mechanically blocked a change.
- **The `legacy*` files are not upstream shims.** `legacyActivityBridge.ts` bridges `CustomerActivity` to `CustomerInteraction`; `legacyPublicDriver.ts` reads an older public storage layout. Both protect existing rows and files — the same persistence principle as ADR-0004. Retained.
- **Modules are freely removable.** `enabledModules` is a plain array in `apps/mercato/src/modules.ts`, and `module-decoupling.test.ts` proves the app runs with `catalog`, `sales` and `api_keys` disabled.

Left deliberately:

- **`.snapshot-open-mercato.json`** (47 files). The name is a hardcoded constant in `packages/cli/src/lib/db/commands.ts`. Renaming it would make every module look like it has no snapshot, and `db:generate` would emit a duplicate initial migration for all 45 of them. Cosmetic name, real hazard — not worth it.
- **`@open-mercato/*` package scope.** Unchanged, per ADR-0001.

## Resolved: `packages/create-app` removed (2026-08-23)

The scaffolder is gone. It existed to `npx create-mercato-app` a standalone app
against **published** `@open-mercato/*` npm packages — a distribution mechanism
Operis does not use — and its provenance harness pinned upstream git commit SHAs
this repository does not and should not contain. That harness produced the only
10 failing tests in the suite.

Removed: 517 files (`template/` 420, `src/` 77, `scripts/` 12, plus manifest and
bin). **Kept: `agentic/` (160 files), relocated to `packages/cli/agentic/`** — it
is genuinely consumed. `packages/cli/build.mjs` copies it into the CLI's dist so
`mercato agentic:init` can emit it, and `yarn lessons:check` runs a script from
it. It now lives with its consumer instead of in a package that existed to
publish it.

Fallout fixed, in the order the toolchain surfaced it:

| Broke | Fix |
|---|---|
| `packages/cli` build — reference projections read the deleted template | Repointed at `apps/mercato`, which has the same `example` module. More accurate anyway: the projections now describe the real app |
| `mercato agentic:init` dev path | `packages/cli/agentic` (my first attempt landed on `packages/agentic` — one `..` too many) |
| `yarn lessons:check` | Repointed at the relocated script |
| 4 CLI tests using `template/` as a fixture | Repointed at `apps/mercato`; the app↔template byte-parity test deleted (it had no counterpart left) |
| `core` — `explicit-sort-comparators` expected a `create-app/src` scan root | Expectation removed (the roots list is auto-discovered) |
| `core` — `design_system` inventory parity | Repointed at the inventory that survived inside `agentic/` |
| `telemetry`, `search`, `ui`, `app` — 5 suites scanning both app and template | Template paths dropped; three app↔template parity tests deleted |
| Dockerfile, `turbo.json`, root scripts, `.github/workflows` | `create-app` build/test tasks, COPY lines, `test:create-app*` and `template:sync*` scripts, and the CI template-parity step removed |

Also removed while in there: `packages/enterprise` was still listed in
`package-previews.yml` and in `ci.yml`'s full-suite path pattern — leftovers from
the enterprise exclusion.

**Result: the full test suite passes for the first time.** 2,295 suites, 20,434
tests, 0 failures, exit 0. Net −14 tests, all of them app↔template parity checks
whose counterpart no longer exists.

### Flagged, not actioned: the npm publish pipeline

While removing create-app's CI usage I found that `.github/workflows/snapshot.yml`
triggers on **push to `develop`** and publishes every `@open-mercato/*` package to
npm (`npm publish --provenance`, `NPM_TOKEN`). Operis publishes nothing and does
not own that scope, so it cannot succeed — but it is the most dangerous shape of
upstream coupling because it is automatic rather than opt-in.

Its `standalone-integration` job was removed (it scaffolded via the deleted CLI),
so the workflow no longer references create-app. **The publishing itself is left
intact and is a decision for you**, because it is a coherent cluster well beyond
this change: `snapshot.yml`, `npm-snapshot-preview.yml`, `package-previews.yml`,
seven `scripts/release-*.sh` / `publish-packages.sh` / `registry/publish.sh`, and
eight `package.json` script entries.

Worth noting that ADR-0004 — which frees the internal contract surfaces — rests on
the premise that Operis publishes nothing. Leaving an automatic publish pipeline
in place quietly contradicts it.

## Resolved: npm publish pipeline removed (2026-08-23)

ADR-0004 frees the internal contract surfaces on the premise that **Operis
publishes nothing**. An automatic publish pipeline quietly contradicted that, so
it is gone.

The hazard was `.github/workflows/snapshot.yml`: it triggered on **push to
`develop`** and ran `npm publish --provenance` for every `@open-mercato/*`
package — a scope Operis does not own. It could not have succeeded, but it was
the only piece of upstream coupling that fired automatically rather than on
request.

Removed (16 files):

| | |
|---|---|
| Workflows | `snapshot.yml` (push-triggered publish), `release.yml`, `npm-snapshot-preview.yml`, `package-previews.yml` |
| Scripts | `publish-packages.sh`, `check-version-unpublished.sh`, `registry/publish.sh`, `registry/setup-user.sh`, `release-{patch,minor,major,existing,snapshot}.sh`, `lib/verdaccio.ts` |
| Guards | `publish-package-metadata.test.mjs`, `npm-provenance-runners.test.mjs` |
| Manifests | `publishConfig` removed from all 23 packages — the field existed only to publish |
| Root scripts | `registry:*`, `release:{snapshot,existing,patch,minor,major}`, `release:check-unpublished` |

**Kept deliberately**, because version numbers are surfaced at runtime
(`/api_docs/version`, the system-status panel) and versioning is not publishing:

- `scripts/bump-version.sh` and the `release:bump` script
- `.github/workflows/release-prepare.yml` — bump, verify the tag is free, open a
  release PR. Its "verify the version is not published yet" step was removed;
  that step queried npm.
- `scripts/changelog-section.sh` and the changelog guards in
  `release-workflow.test.mjs`. Eight tests in that file asserted on the deleted
  `release.yml` and were removed; the five that guard the changelog and
  `release-prepare` remain and pass.

Also cleaned in the same pass: a dangling `template:sync:ask` script pointing at
a deleted file, two stale `create-app/template` scan roots in core coverage
tests, and a comment path that moved with `agentic/`.

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
