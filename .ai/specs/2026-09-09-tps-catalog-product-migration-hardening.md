# TPS Catalog Product Migration Hardening

## 📝 TLDR

Harden the `migrate_tps products` importer so TPS service-menu data lands in Catalog with the same business meaning as the source menu: service products, default variants, option-tree modifiers, bookable-service summary fields, translations, and product/option constraints. The current importer creates usable catalog records, but option constraints are not reliable because TPS option ids are not globally unique, and some constraints are interpreted at product level even though comments describe option-level behavior. The fix should introduce a reusable service-menu import contract so future business-specific importers can use the same validation and mapping primitives instead of cloning TPS-specific assumptions.

## 📝 Problem Statement

`packages/migrate-tps/src/modules/migrate_tps/products.ts` currently imports every `SERVICE_MENU` item as a Catalog service product with one default variant and an option tree. That model is directionally correct for TPS because options represent modifiers and choices, not retail SKU variants.

The weak point is that the migration treats `Option.id` as globally unique. Runtime inspection of `SERVICE_MENU` showed 65 distinct option ids with 31 duplicate ids across the tree, including `polish-regular`, `scope-mani`, `area-half`, and `area-full`. `tpsOptionMap.set(opt.id, optionEntity.id)` overwrites earlier options, so constraints sourced from repeated option ids can point to the last matching option rather than the intended option in the current product path.

There is also a semantic mismatch in Nail constraints. Several comments say an option conflicts with Regular Polish (`type-regular`), but the data uses `conflictsWithItems: ['polish']`, and the importer always resolves that target as the whole `polish` product. This changes the business rule from "conflicts with the Regular Polish option" to "conflicts with all Nail Polish".

Finally, TPS services are not fully bookable through Catalog's existing public booking helper because `bookable-services` only lists products with `customFieldsetCode = service_schedule`, and it reads duration from product custom fields rather than option-tree or variant duration.

## 📝 Proposed Solution

Keep the existing high-level import model:

- one Catalog `service` product per TPS service-menu item
- one default variant per product
- option-tree groups/options for all menu choices, add-ons, durations, ranges, and nested selectors
- constraints as first-class `CatalogProductConstraint` rows

Change the importer internals so it uses a scoped option registry rather than global option ids, and change the service-menu source contract so product targets and option targets are explicit. Add a validation layer that fails fast when source data is ambiguous or cannot be mapped.

Introduce reusable service-menu migration primitives under `packages/migrate-tps/src/modules/migrate_tps/` first. They can stay inside the package for this delivery, but their API should not encode TPS-only names beyond adapter input/output. Future importers should be able to provide another menu tree and receive the same catalog migration plan.

## 📝 Resolved Assumptions

- TPS menu products are bookable by default. All imported service products should get `customFieldsetCode = service_schedule` unless a future source item explicitly opts out.
- Product-level duration is a discovery summary, not the source of truth. Variant and option duration remain authoritative for configured service choices.
- For product-level `service_duration_minutes`, use a single parsed item duration when present. For duration ranges, store the minimum as the discovery duration and preserve the range in metadata. If duration exists only in options, leave product-level duration unset unless a default path is later defined.
- Existing Catalog option-tree design remains in place. Do not explode TPS option combinations into variants.
- No new production dependency is needed.

## 📝 Architecture

### Current Flow

`migrate_tps products` does the following:

1. Creates or finds the default `CatalogPriceKind`.
2. Loads depth-1 categories and maps them by category label.
3. Iterates `SERVICE_MENU`.
4. Creates `CatalogProduct` for each item.
5. Creates one default `CatalogProductVariant`.
6. Recursively creates `CatalogProductOptionGroup` and `CatalogProductOption`.
7. Runs a second pass to create `CatalogProductConstraint`.

### Target Flow

Keep the two-pass structure, but split it into explicit stages:

1. Validate source menu.
2. Build a deterministic source index:
   - product index by source product id
   - option occurrence index by scoped key
   - option occurrences by product id and option id
   - category index by source category id and label
3. Create catalog products, variants, prices, option groups, and options.
4. Record every created catalog id in a migration registry with path-aware keys.
5. Resolve constraints from explicit source references.
6. Persist constraints only after all referenced source records are known.
7. Optionally persist product custom field summaries needed by booking.

### Reusable Import Contract

Define source-level reference types that do not assume TPS-specific ids are globally unique:

```ts
type ServiceMenuProductRef = {
  productId: string
}

type ServiceMenuOptionRef = {
  productId: string
  optionId: string
  groupPath?: string[]
  optionPath?: string[]
}

type ServiceMenuConstraintRef =
  | { kind: 'product'; productId: string }
  | { kind: 'option'; productId: string; optionId: string; groupPath?: string[]; optionPath?: string[] }
```

The importer should accept legacy TPS shorthands only through a normalization step. The normalized plan should never contain an ambiguous bare option id.

## 📝 Data Model

No database schema change is required for the first hardening pass. Existing Catalog entities are sufficient:

- `CatalogProduct`
- `CatalogProductVariant`
- `CatalogProductPrice`
- `CatalogProductOptionGroup`
- `CatalogProductOption`
- `CatalogProductConstraint`
- `EntityTranslation`
- custom field values for `service_schedule`

### Product Defaults

Imported TPS service products should set:

```ts
productType: 'service'
primaryCurrencyCode: 'VND'
defaultUnit: 'service'
defaultSalesUnit: 'service'
requiresShipping: false
customFieldsetCode: 'service_schedule'
isConfigurable: false
```

`isConfigurable: false` remains intentional for TPS because option tree modifiers are not retail variant schemas. `productType: 'service'` is the business classification.

Product metadata should preserve source context:

```ts
metadata: {
  tps_id: item.id,
  tps_type: category.type ?? 'unknown',
  tps_tab_id: tab.tabId,
  tps_category_id: category.id,
  tps_category_label: category.label,
  tps_duration: originalDuration ?? null,
  tps_duration_range: { min, max } | null
}
```

### Variant Defaults

Each product keeps exactly one default variant:

```ts
name: 'Default'
isDefault: true
isActive: true
customFieldsetCode: 'service_schedule'
durationUnit/durationValue/durationMin/durationMax from item duration
```

Variant prices continue to use `CatalogProductPrice` rows linked to both product and variant. Price ranges should keep `priceMin` and `priceMax`; flat prices should use `unitPriceGross`.

### Options

Each imported option should set:

```ts
code: opt.id
metadata: {
  tps_id: opt.id,
  tps_path: scoped path,
  tps_product_id: source product id
}
```

`code` uniqueness is scoped by option group, so duplicate option ids across different products/groups are acceptable.

### Custom Fields

When a product has a useful discovery duration, set:

- entity: `E.catalog.catalog_product`
- fieldset: `service_schedule`
- field: `service_duration_minutes`

This is only a listing/bookable summary. It must not replace option-level duration or price.

## 📝 API Contracts

No new public API endpoint is required.

One existing Catalog API should be checked and likely fixed:

- `GET /api/catalog/products/:id/option-tree`

It currently serializes constraints sourced from `sourceProduct = productId`. It should include constraints where the source is any option belonging to the product:

```ts
$or: [
  { sourceProduct: productId },
  { sourceOption: { group: { product: productId } } },
]
```

The dedicated constraints endpoint already follows this broader source query and should remain the reference behavior.

## 📝 Constraint Semantics

### Product Include

Source:

```ts
include: { itemId: 'cuticle-prive-technique', locked: false }
```

Target:

```ts
constraintType: 'includes_item'
sourceProduct: current product
targetProduct: included product
locked: include.locked ?? false
```

Meaning: choosing or configuring the source service includes the target service.

### Product Mutual Exclusion

Source:

```ts
mutuallyExclusiveItems: ['lash-lift']
```

Target:

```ts
constraintType: 'mutually_exclusive_item'
sourceProduct: current product
targetProduct: referenced product
```

Meaning: the two service products cannot be chosen together.

### Option Conflicts With Product

Source:

```ts
conflictsWithItems: ['builder-gel']
```

Target:

```ts
constraintType: 'conflicts_with_item'
sourceOption: current option occurrence
targetProduct: referenced product
```

Meaning: selecting the source option conflicts with the target product.

### Option Conflicts With Option

Add an explicit source field:

```ts
conflictsWithOptions: [{ productId: 'polish', optionId: 'type-regular' }]
```

Target:

```ts
constraintType: 'conflicts_with_item'
sourceOption: current option occurrence
targetOption: referenced option occurrence
```

Meaning: selecting the source option conflicts with a specific option, not the whole target product.

### Option Mutual Exclusion

Legacy source:

```ts
mutuallyExclusive: ['area-full']
```

Resolution rule:

- resolve within the current source product first
- if more than one match exists in that product, require `groupPath` or `optionPath`
- never resolve by final global occurrence

Target:

```ts
constraintType: 'mutually_exclusive_item'
sourceOption: current option occurrence
targetOption: same-product referenced option
```

## 📝 Source Data Changes

Extend `Option` in `data/types.ts`:

```ts
conflictsWithOptions?: Array<{
  productId: string
  optionId: string
  groupPath?: string[]
  optionPath?: string[]
}>
```

Update TPS Nail rules whose comments say "Regular Polish (`type-regular`)":

- `builder-gel > builder-type > gelish-structure`
- `builder-gel > builder-type > plexigel-overlay`
- `nail-art > service-scope > service-scope-manicure`
- `nail-art > service-scope > service-scope-pedicure`
- `extension-type > extension-type-selection > full-set`
- `extension-type > extension-type-selection > refills`

Change those from `conflictsWithItems: ['polish']` to:

```ts
conflictsWithOptions: [{ productId: 'polish', optionId: 'type-regular' }]
```

Keep Regular Polish rules that conflict with products:

```ts
conflictsWithItems: ['builder-gel', 'extension-type', 'art-level']
```

Those describe "if Regular Polish is selected, these products are incompatible."

## 📝 Edge Cases & Failure Scenarios

- Duplicate product id: fail migration before writing records.
- Duplicate product handle/SKU after normalization: fail before writing records.
- Constraint target product missing: fail before writing records.
- Constraint target option missing: fail before writing records.
- Constraint target option ambiguous: fail and print candidate paths.
- Legacy bare `mutuallyExclusive` target matches multiple options in the same product: fail and require scoped ref.
- Duration range cannot be represented in `service_duration_minutes`: store range in metadata and use minimum only for discovery.
- Product has only option-level duration: leave product custom field empty unless a default option path exists.
- Translation key missing in every TPS locale: skip translation row for that field but include validation warning.
- Existing products with `--replace` false: keep current abort behavior.
- Existing products with `--replace` true: cleanup must stay tenant/org scoped.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---:|---|
| Changing `conflictsWithItems: ['polish']` to option-level target changes admin-visible constraints | High | This matches the source comments; add regression tests naming each changed rule |
| Product-level `service_schedule` makes all TPS services appear in booking API | Medium | Add opt-out field in source type if needed before enabling non-bookable imports |
| Product custom field writes may require generated entity ids/imports | Medium | Use existing data engine/custom-field helper used by catalog seed examples |
| Existing migrated data from earlier runs may be stale | Medium | Require rerun with `--replace`; do not attempt in-place data repair in this spec |
| Option id duplicate handling increases code complexity | Medium | Isolate in pure registry helpers with focused unit tests |
| `option-tree` route query change broadens response | Low | Match behavior of constraints endpoint; cover with unit/API test |

Rollback is simple for TPS seed data: rerun the migration with `--replace` after reverting the code change. No schema rollback is expected because this plan does not require a migration.

## 📋 Phasing

### Phase 1: Pure Source Validation and Registry

Create pure helpers that validate `SERVICE_MENU` and build a scoped product/option index without touching the database.

Deliverables:

- source menu validator
- scoped option key builder
- option occurrence registry
- unit tests proving duplicate option ids do not overwrite each other

### Phase 2: Constraint Normalization

Normalize source constraints into explicit product/option refs.

Deliverables:

- `conflictsWithOptions` source type
- updated Nail source data for Regular Polish option conflicts
- same-product resolver for `mutuallyExclusive`
- regression tests for Waxing women/men `area-half` and `area-full`

### Phase 3: Product/Variant Service Defaults

Fill Catalog service fields consistently.

Deliverables:

- product `primaryCurrencyCode`, units, fieldset, shipping flag
- variant fieldset
- metadata with source category/tab/duration context
- duration summary extraction for custom fields

### Phase 4: Database Migration Execution

Wire the registry and normalized constraints into `migrate_tps products`.

Deliverables:

- path-aware `sourceOption` resolution
- option-target constraint creation
- fail-fast logging for unresolved/ambiguous refs
- no silent skips for invalid constraints

### Phase 5: Catalog API Alignment

Align option-tree constraint loading with constraints endpoint behavior.

Deliverables:

- `GET /api/catalog/products/:id/option-tree` includes source-option constraints
- focused test proving option-sourced constraints are returned

### Phase 6: Reusable Business Import Surface

Make the final helper layer usable by non-TPS importers.

Deliverables:

- generic names for service-menu registry/validation helpers
- TPS adapter remains thin
- docs/comments explaining stable source id rules
- no production dependency added

## 📋 Implementation Plan

1. Add a pure `serviceMenuImportPlan` helper module with source traversal, product indexing, option occurrence indexing, duplicate detection, and scoped key construction.
2. Add tests that load `SERVICE_MENU` and assert product ids, generated SKUs, and generated handles are unique.
3. Add tests showing `polish-regular` appears in multiple products and all occurrences remain addressable by scoped path.
4. Add `conflictsWithOptions` to `Option` in `data/types.ts`.
5. Update the TPS Nail source rules that currently target `['polish']` but comment "Regular Polish (`type-regular`)".
6. Add a constraint normalization helper that emits a database-ready intermediate shape with explicit `sourceProductId/sourceOptionId/targetProductId/targetOptionId` source references.
7. Add tests for normalized constraints:
   - package `polish-regular` constraints source the correct package option occurrence
   - `builder-gel > gelish-structure` targets `polish > type-regular`
   - `extension-type > full-set` targets `polish > type-regular`
   - `wax-arms-women area-half` targets women `area-full`
   - `wax-arms-men area-half` targets men `area-full`
8. Refactor `traverseOptionTree` to receive the registry and current source path, then store created catalog option ids by scoped occurrence rather than bare `opt.id`.
9. Refactor pass 2 in `products.ts` to consume normalized constraints and create `CatalogProductConstraint` rows from explicit refs.
10. Change invalid constraint refs from silent skip to fail-fast errors with source path and candidate paths.
11. Set product service defaults: `primaryCurrencyCode: 'VND'`, `defaultUnit`, `defaultSalesUnit`, `requiresShipping: false`, and `customFieldsetCode: 'service_schedule'`.
12. Set default variant `customFieldsetCode: 'service_schedule'` and preserve item duration on the variant.
13. Add product metadata for source tab/category and duration/range context.
14. Persist product custom field `service_duration_minutes` when a safe summary duration exists.
15. Set `CatalogProductOption.code = opt.id` and add option metadata with source path.
16. Update `GET /api/catalog/products/:id/option-tree` to load constraints where source is the product or an option of the product.
17. Add a focused catalog test for option-tree constraints.
18. Run validation:
   - `yarn workspace @open-mercato/migrate-tps typecheck`
   - `yarn workspace @open-mercato/migrate-tps test`
   - `yarn workspace @open-mercato/core typecheck`
   - focused catalog API tests for option-tree if touched

## 📋 Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Pure Source Validation and Registry | Done | Added `serviceMenuImportPlan` with product uniqueness checks, scoped option keys, occurrence indexing, and regression coverage for duplicate option ids. |
| Phase 2: Constraint Normalization | Done | Added explicit `conflictsWithOptions`, normalized Regular Polish comments to option refs, and resolved legacy option mutual exclusions inside the current product. `wax-arms-men` has no source mutual-exclusion rule today, so no synthetic constraint is emitted. |
| Phase 3: Product/Variant Service Defaults | Done | Imported services now set service defaults, booking fieldset config, source metadata, variant fieldset, and discovery duration summaries when safely derivable. |
| Phase 4: Database Migration Execution | Done | `products.ts` now consumes the normalized import plan, records catalog ids by scoped source key, creates product/option target constraints, and fails fast for unresolved refs. |
| Phase 5: Catalog API Alignment | Done | Option-tree API now loads constraints sourced by the product or by any option under that product, with focused test coverage. |
| Phase 6: Reusable Business Import Surface | Partially done | Helper names and types are business-generic enough for reuse inside `migrate-tps`; extracting them to a shared package should wait until a second importer appears. |

## 📝 Final Compliance Checklist

- Tenant and organization scoping stays on every created row.
- No direct cross-module ORM relationship is introduced.
- No generated file is edited by hand.
- No production dependency is added.
- Constraint rows satisfy exactly-one-source and exactly-one-target checks.
- Source data ambiguity fails before partial writes.
- Product/variant/option prices and durations preserve TPS meaning without variant explosion.
- Bookable service compatibility is explicit through `service_schedule`.
- Future importers can reuse the registry and validation helpers without depending on TPS comments.

## 📝 Changelog

- 2026-09-09: Initial hardening plan for TPS product migration into Catalog, including reusable service-menu import contract and constraint semantics cleanup.
- 2026-09-09: Implemented scoped option import planning, explicit option constraint refs, Catalog service defaults, booking duration summaries, and option-tree constraint loading alignment.
- 2026-09-09: Added service-schedule fieldset config seeding to the TPS product migration so Catalog custom-field UI has the same fieldset structure as bookable services.
