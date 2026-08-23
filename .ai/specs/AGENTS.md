# Specs Folder — Agent Rules

Check `.ai/specs/` before modifying any module. Create or update specs when the change is non-trivial.

## Always

- Check the spec directory before modifying a module.
- Create a new spec for a new module, significant feature, or architecture change touching multiple files.
- Update an existing spec when changing APIs, data models, workflows, permissions, or cross-module behavior.
- Keep specs implementation-accurate and update the changelog after implementation.
- Use the root Task Router to identify all related guides for review.

## Ask First

- Ask before moving a spec to `implemented/` if deployment/completion evidence is incomplete.
- Ask before renaming legacy spec files or changing the spec directory taxonomy.

## Never

- Never introduce new `SPEC-*` filename prefixes.
- Never leave stale endpoints, entities, or assumptions in an updated spec.

## Validation Commands

```bash
find .ai/specs -maxdepth 2 -name '*.md' -print
```

## Spec Separation

- `.ai/specs/` contains every specification in this repository. All of it is MIT.
- Upstream's commercial `.ai/specs/enterprise/` directory was **not imported** —
  see [`LICENSE.md`](LICENSE.md). Do not recreate it, and do not write specs that
  derive from Open Mercato Enterprise Edition implementations.

## Spec Lifecycle States

Specs are organized by implementation status:
- **Root** (`.ai/specs/`): Pending, draft, in-progress, or partially implemented specs
- **Implemented** (`.ai/specs/implemented/`): Fully implemented and deployed specs

Move a spec to `implemented/` when all phases are complete and the feature is deployed. Use `git mv` to preserve history. Update all cross-references when moving.

## Detailed Guidance

For detailed spec writing and review, use the spec-writing skill:
- `.ai/skills/om-spec-writing/SKILL.md`

## Create/Update Triggers

- Create a new spec for a new module, significant feature, or architecture change touching multiple files.
- Update an existing spec when changing APIs, data models, workflows, permissions, or cross-module behavior.
- Skip specs for small bug fixes, typo-only edits, and isolated one-file refactors with no behavior change.

## File Naming Convention

Use the naming format:
- `{date}-{title}.md`
- `date`: `YYYY-MM-DD`
- `title`: kebab-case summary
- Legacy numbered filenames may remain in the repo until they are intentionally normalized, but new specs MUST NOT introduce `SPEC-*` filename prefixes.

Examples:
- `2026-02-11-confirmation-dialog-migration.md`
- `2026-02-12-example-module.md`

## Workflow Triggers

### Before coding

- Find related spec(s), read current intent, and identify deltas.
- If no spec exists and triggers apply, create one before implementation.

### During coding

- Keep spec sections in sync with architecture and API/model decisions.
- Record scope changes and tradeoffs as they happen.

### After coding

- Update changelog with exact date and concise summary.
- Re-run review checklist and final compliance gate before approval.

## Spec Content Checklist

- Every non-trivial spec includes: TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report, Changelog.
- Risks must document concrete failure scenarios, severity, affected area, mitigation, and residual risk.
- Keep specs implementation-accurate: no stale endpoints, entities, or assumptions.
- Use Task Router from root `AGENTS.md` to identify all related guides for review.
