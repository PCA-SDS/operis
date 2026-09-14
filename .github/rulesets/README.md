# Branch rulesets

Repository settings that cannot live in a workflow file, kept in git so they are reviewable
and reproducible rather than remembered.

## Why these are not applied automatically

`main-protection.json` requires the status check `ci-required`. **Applying it before the
workflow that defines that job is merged to `main` blocks every open pull request**, with no
way for any of them to satisfy a check that does not yet exist.

So the order is fixed, and it is the reason this is a documented command rather than a step
in CI:

1. Merge the pull request that adds the `ci-required` job to `.github/workflows/ci-deploy.yml`.
2. Let one run finish on `main`, so GitHub has seen a check run named `ci-required` and will
   offer it in the required-checks list.
3. Apply the ruleset (below).
4. Open a throwaway pull request that deliberately fails one check and confirm the merge
   button is blocked. **An unverified gate is the same as no gate.**

## Apply

```bash
gh api --method POST repos/PCA-SDS/operis/rulesets --input .github/rulesets/main-protection.json
```

Update an existing ruleset in place — `gh api repos/PCA-SDS/operis/rulesets` lists the ids:

```bash
gh api --method PUT repos/PCA-SDS/operis/rulesets/<id> --input .github/rulesets/main-protection.json
```

## What it enforces

| Rule | Effect |
|---|---|
| `pull_request` | No direct pushes to `main`; one approving review; stale approvals dismissed on a new push. |
| `required_status_checks` → `ci-required` | The single aggregator job must pass. `strict_required_status_checks_policy` also requires the branch to be up to date with `main` before merging. |
| `deletion`, `non_fast_forward` | `main` cannot be deleted or force-pushed. |

`bypass_actors` is deliberately empty. Add an entry only for a named, time-limited reason —
an admin bypass that nobody remembers granting is how a required check quietly stops being
required.

## Only one required check, on purpose

`ci-required` waits on every gate job and inspects each result explicitly. Listing the gate
jobs here instead would break in two ways:

- A conditional job that legitimately skips never reports a conclusion, so a pull request
  that does not need it would sit pending forever.
- The list would need re-editing in repository settings every time a job is added. That step
  is always forgotten, and forgetting it silently widens what can merge.

`scripts/__tests__/validation-gate-parity.test.mjs` asserts that every checking job is wired
into `ci-required`'s `needs`, so the single required check cannot drift away from the real
gate.

## Merge queue

The `merge_group` lane in `ci-deploy.yml` runs the full, unfiltered test suite. It does
nothing until the merge queue is switched on, which is a repository setting rather than a
ruleset field:

**Settings → General → Pull Requests → Merge queue**, or:

```bash
gh api --method PATCH repos/PCA-SDS/operis --field allow_merge_queue=true
```

Available on this repository at no cost: merge queues are free for public repositories.
Until it is enabled, pull requests still run the scoped lane and `main` still runs the full
lane on push — the loss is only that a scoped-lane miss reddens `main` instead of being
caught before the commit lands.
