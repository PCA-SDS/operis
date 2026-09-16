# CI Two-Lane Gate and Scoped Tests

**Status:** implemented
**Date:** 2026-09-14
**Scope:** `.github/workflows/ci-deploy.yml`, `.github/actions/setup/`, `.github/rulesets/`,
`turbo.json`, `scripts/ci-test-scope.mjs`, `scripts/__tests__/validation-gate-parity.test.mjs`,
root `package.json`, `.ai/agentic.config.json`

Extends [`2026-08-29-ci-pipeline-reliability-and-speed.md`](2026-08-29-ci-pipeline-reliability-and-speed.md),
which produced the single-job shape this replaces.

---

## TLDR

The pipeline was fast enough to ignore and advisory enough to bypass. Four findings, three of
which were about correctness rather than speed:

- **`main` had no branch protection and no rulesets.** `GET /branches/main/protection`
  returned 404. Every check was advisory; a red pull request could be merged.
- **No dependency audit ran on a pull request.** `audit.yml` describes itself as the
  "time-triggered counterpart to the `audit` job in ci.yml", and `ci.yml` no longer exists in
  this repository. The pull-request half of that pair had been silently gone.
- **`typecheck` had no edge in the turbo graph**, so a breaking change in
  `packages/shared/src` left `@open-mercato/core#typecheck` replaying a cached PASS.
- Unit tests were **466s of a 935s** cold run, and 62% of every test file in the repository
  (1,537 of 2,492) sits in one turbo package that no filter can reach inside.

The fix is two lanes and one gate: a pull request runs a scoped selection behind a single
required aggregator check; the merge queue runs the suite unfiltered before the commit
becomes reachable from `main`.

---

## Findings

### 1. The turbo `typecheck` edge — and why it is `^typecheck`, not `^build`

`turbo run typecheck --dry=json` showed `@open-mercato/core#typecheck` with an **empty
`dependencies` array** and inputs limited to its own package files. Turbo hashes a package's
own files only, so a breaking change in `packages/shared/src` did not invalidate core's
cached typecheck result. Same class of false green that `tasks.test`'s `dependsOn: ["^build"]`
edge exists to prevent, and the reason that edge is documented at length in `turbo.json`.

The first-drafted fix was `dependsOn: ["^build"]`, by analogy. **That was wrong**, and the
evidence is that `packages/shared/dist/index.d.ts` does not exist — nor does any other
`.d.ts` anywhere in the repository:

```
$ find packages/*/dist -name "*.d.ts" | wc -l
0
```

`build.mjs` emits JavaScript only. Every cross-package type resolution therefore goes through
the `types` conditions in `package.json` `exports`, which point at the sibling's **source**.
An edge to `^build` would have forced a full build ahead of every typecheck and bought
nothing. `^typecheck` creates the same hash dependency at no build cost.

Verified after the change by perturbing a real file:

```
$ printf '\n// probe\n' >> packages/shared/src/lib/boolean.ts && npx turbo run typecheck
@open-mercato/shared:typecheck: cache miss, executing
@open-mercato/ui:typecheck:     cache miss, executing
@open-mercato/core:typecheck:   cache miss, executing
Cached: 2 cached, 26 total
```

The whole repository typechecks in **9.93s** with the edge in place and the cache forced off,
so the added topological ordering costs nothing measurable.

### 2. Measured baseline

Two real pull-request runs — `34764127622` (cold, 15m53s) and `34702314493` (warm, 8m31s):

| Step | Cold | Warm |
|---|---|---|
| Install | 92s | 52s |
| Lint | 13s | 2s |
| build → generate → build | 72s | 38s |
| Repo-wide guards | 71s | 74s |
| Script tests + time bombs | 7s | 8s |
| Typecheck | 107s | 25s |
| **Unit tests** | **466s** | **220s** |
| Cache restore + re-upload | 107s | 40s |

`turbo` reported `test: 55 tasks, 25 cached, 7m44s` — package-level affected selection is
already working. The residue is `packages/core`.

### 3. Why no turbo filter can help with `packages/core`

One workspace package, 48 modules, 1,537 test files. Turbo's unit of filtering **and** caching
is the package, so a one-line change in `modules/chat/` rehashes `@open-mercato/core#test` and
reruns all of it. Splitting core into 48 packages would be the "correct" fix and is rejected:
162 distinct module-to-module import edges, the generated registries, and `@open-mercato/core/*`
import paths throughout the tree.

---

## What Changed

### Phase 0 — the gate

- **`ci-required`**, an aggregator job with `if: always()` and `needs:` every gate job, which
  inspects each result and fails on anything that is not `success` or `skipped`. It is the
  only name a ruleset has to carry.
- **`.github/rulesets/main-protection.json`**, committed but **deliberately not applied** —
  applying a ruleset that requires `ci-required` before that job exists on `main` blocks every
  open pull request. `.github/rulesets/README.md` carries the ordering and the verification
  step.
- **An `audit` job** running `yarn audit:ci` — the same `scripts/audit-ci.mjs` and the same
  allowlist as the scheduled half, restoring the pair `audit.yml` assumes exists.

### Phase 1 — structural

- `turbo.json`: `typecheck` gains `dependsOn: ["^typecheck"]` (see Finding 1).
- The single `quality` job becomes **`prepare` + five concurrent gate jobs**
  (`lint`, `typecheck`, `guards`, `audit`, `test`).
- **`.github/actions/setup`**, a local composite action holding the shared prologue. Only
  `prepare` passes `save-cache: true`; every other job restores read-only.

Wall clock does **not** drop proportionally and the change is not justified on that basis:
tests dominate either shape. What improves is feedback latency — lint and typecheck report in
about three minutes instead of after the 466s test step — and every job becomes
independently re-runnable.

### Phase 2 — scoped tests

**`scripts/ci-test-scope.mjs`** is one entry point running both halves of the scoped lane:

1. Every package except core, via `--filter=...[base] --filter=!@open-mercato/core`. Verified
   with `--dry=json` that a negative filter removes `<pkg>#test` from the selection while
   leaving `<pkg>#build` available to dependents.
2. `packages/core`, narrowed with `jest --findRelatedTests`, which walks real module
   resolution — so the 162 cross-module edges are followed with no hand-maintained map.

Both halves always run, so one push surfaces every failure.

**What `--findRelatedTests` cannot see**, and the three things that compensate:

| Compensation | What it covers |
|---|---|
| `ALWAYS_RUN` — the 24 suites in `src/__tests__/`, every invocation | `module-decoupling`, feature-policy coverage, optimistic-lock coverage, UI gating — the guards over exactly the dynamic wiring Jest's graph misses |
| `STRUCTURAL_PATHS` — forces the full suite | `di.ts`, `index.ts`, `events.ts`, `acl.ts`, `setup.ts`, `subscribers.ts`, `ce.ts`, `widgets/`, `data/extensions.ts`, `generated/`, manifests |
| The `merge_group` lane | Everything, unfiltered, before the commit is reachable from `main` |

**Fail-safe, not fail-open.** Every uncertain input resolves to `full`: an unreadable diff, a
base ref that does not resolve (the shallow-clone case, checked with `rev-parse` *before*
diffing so an empty diff cannot be mistaken for "nothing changed"), a path containing
characters no source file in this tree uses, or any structural path. `--passWithNoTests` is
deliberately absent from the narrowed invocation.

`scripts/__tests__/ci-test-scope.test.mjs` covers all of it — 17 tests, every one about the
single failure mode that matters: a green run that tested nothing.

### Phase 3 — supply chain

- **Trivy scan** of the built image before it can deploy, `HIGH,CRITICAL --ignore-unfixed`.
  Pinned by tag *and* digest: it runs in the one job holding `packages: write`.
- **`--provenance=mode=max --sbom=true`** on every published tag.
- **Every action digest-pinned.** 32 references across four workflows and the composite
  action. Dependabot already tracks the `github-actions` ecosystem, so the pins stay current.
- **`merge_group` builds verify but never publish.** A queued commit may still be dequeued;
  publishing `:latest` from it would point the tag at code that never merged.

---

## Guard Updates

`scripts/__tests__/validation-gate-parity.test.mjs` hardcoded `GATE_JOB = 'quality'`. A job
rename would have made it read a job that no longer existed. It now **derives** the gate from
`ci-required`'s `needs` — the same list branch protection enforces — and also parses the
composite action, since the shared prologue moved there. Two assertions were added:

- every checking job is wired into `ci-required`'s `needs`, so a new gate job cannot run
  un-enforced;
- the aggregator inspects `needs` results explicitly, because `if: always()` means `needs`
  alone would let it report success regardless of what its dependencies did.

---

## Deliberately Not Done

- **Turbo remote cache.** The workflow change is independent of it, and it needs
  infrastructure that does not exist yet. When it lands, the security condition is
  non-negotiable: this repository is public, and a write-capable cache token reachable from a
  fork pull request is remote code execution on every later run that restores a poisoned
  entry. Fork runs must be read-only.
- **Integration tests in CI.** No workflow runs `test:integration` today. Adding a minimal
  job would conflict with [`2026-06-05-phased-integration-ci.md`](2026-06-05-phased-integration-ci.md),
  an existing draft with a materially larger design, and would risk the silent coverage drop
  that spec's constraints exist to prevent. Deferred to that spec.
- **A Dockerfile `HEALTHCHECK`.** `deploy/docker-compose.prod.yml:115` already defines one
  against `/api/configs/health`. A second definition in the image would be duplicated config
  free to drift from the one that actually runs.
- **Splitting `packages/core`.** See Finding 3.
- **`mutation-tests.yml`** is still `disabled_manually`. Re-enabling or deleting it is a
  repository-settings decision, left to a maintainer.

---

## Verification

```bash
yarn test:scripts            # 625 tests, includes every workflow guard
yarn lint:check-graph && yarn lint
yarn typecheck:serial
yarn test:repo-wide-guards
node scripts/ci-test-scope.mjs --base origin/main --print
actionlint                   # no errors in ci-deploy.yml or the composite action
```

The gate itself is not verified until a pull request that deliberately fails one check is
confirmed unmergeable. See `.github/rulesets/README.md` — an unverified gate is the same as no
gate.
