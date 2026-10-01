# Catalog product search across all organizations

## Goal

Fix `GET /api/catalog/products?search=...` so an unrestricted “All organizations” scope searches products belonging to every visible organization within the tenant.

## Scope

- Correct the organization scope used by product-list prequeries and list enrichment.
- Add regression coverage for unrestricted organization scope.
- Preserve tenant isolation and restricted organization behavior.

## Non-goals

- No database schema or public API shape changes.
- No changes to search indexing strategy or product ranking behavior.
- No changes to unrelated untracked workspace files.

## Implementation Plan

### Phase 1: Fix and verify product scope

- [ ] 1.1 Commit the execution plan and prepare the bug-fix branch.
- [ ] 1.2 Update catalog product prequeries/enrichment to omit the organization predicate only for an unrestricted scope.
- [ ] 1.3 Add regression coverage and run targeted validation.
- [ ] 1.4 Run the configured validation gate and prepare the PR.

## Risks

- Incorrect scope handling could either hide valid products or expose products from another tenant. The fix retains the tenant predicate and adds a regression test for the unrestricted case.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and verify product scope

- [ ] 1.1 Commit the execution plan and prepare the bug-fix branch.
- [ ] 1.2 Update catalog product prequeries/enrichment to omit the organization predicate only for an unrestricted scope.
- [ ] 1.3 Add regression coverage and run targeted validation.
- [ ] 1.4 Run the configured validation gate and prepare the PR.
