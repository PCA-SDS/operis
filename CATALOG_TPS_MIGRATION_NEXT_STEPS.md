# Catalog TPS Migration Next Steps

## Context

This repository is `E:\Workspace\pca\operis`.

The goal is to migrate the TPS-style service catalog from the older PCA ERP project at `E:\Workspace\pca\pca_erp` into Operis while preserving Operis conventions:

- Catalog remains the owner of sellable/bookable products and services.
- TPS service choices should be modeled as an option tree / modifier tree, not as retail variants.
- Tenant and organization isolation must be preserved everywhere.
- Backend writes should use Operis mutation guard patterns.
- UI must follow the existing backend UI and design-system conventions.

The current migration work lives mainly under:

- `packages/core/src/modules/catalog/migrate-tps/`
- `packages/core/src/modules/catalog/data/entities.ts`
- `packages/core/src/modules/catalog/data/validators.ts`
- `packages/core/src/modules/catalog/api/option-groups/route.ts`
- `packages/core/src/modules/catalog/api/product-options/route.ts`
- `packages/core/src/modules/catalog/api/products/[id]/option-tree/route.ts`
- `packages/core/src/modules/catalog/backend/catalog/products/[id]/options/page.tsx`
- `packages/core/src/modules/catalog/migrations/Migration20260826015211_catalog.ts`

Relevant old PCA ERP references:

- `E:\Workspace\pca\pca_erp\apps\backend\prisma\schema.prisma`
- `E:\Workspace\pca\pca_erp\apps\backend\src\modules\catalog\features\items\items.service.ts`
- `E:\Workspace\pca\pca_erp\apps\frontend\src\modules\appointment\features\appointments\utils\catalog-line.ts`
- `E:\Workspace\pca\pca_erp\apps\frontend\src\modules\appointment\features\appointments\components\CatalogServiceTreePicker.tsx`
- `E:\Workspace\pca\pca_erp\docs\catalog-module-review.md`
- `E:\Workspace\pca\pca_erp\docs\decisions\0001-catalog-module-and-cross-module-dependencies.md`

## Repository Rules To Read First

Before modifying code, read these files:

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `.ai/docs/module-development.md`

Important rules from those docs:

- Every API route must export `openApi`.
- All tenant-scoped data must filter by both `tenant_id` and `organization_id` where applicable.
- Do not expose cross-tenant or cross-organization data.
- Do not hand-edit generated files.
- Run `yarn generate` after adding or modifying auto-discovered module files.
- For non-`CrudForm` backend page writes, use `useGuardedMutation(...).runMutation(...)`.
- Prefer `apiCall`/`readApiResultOrThrow` over raw `fetch`.
- Do not hard-code user-facing strings; use i18n keys.
- Avoid `any`; prefer zod-derived types and explicit runtime narrowing.
- Use design-system primitives and semantic tokens.

## Current State

Implemented so far:

- Added `CatalogProductOptionGroup` and `CatalogProductOption`.
- Added CRUD routes for option groups and product options.
- Added `/api/catalog/products/[id]/option-tree`.
- Added backend UI page `/backend/catalog/products/[id]/options`.
- Added TPS migrate commands:
  - `catalog migrate-tps-categories`
  - `catalog migrate-tps-products`
- Added migration `Migration20260826015211_catalog.ts`.
- Generated entity IDs currently include:
  - `catalog:catalog_product_option_group`
  - `catalog:catalog_product_option`

Recently fixed:

- `page.meta.ts` for the options page now uses `export const metadata` and typecheck passes.
- `option-tree` API now has `metadata`, `openApi`, and scopes by `tenantId + organizationId`.
- TPS product cleanup now scopes by `tenantId + organizationId`.
- TPS category cleanup log now correctly says organization.
- Migration `down()` now drops the new option-tree tables.
- Migration `up()` now drops legacy option tables before creating the new `catalog_product_options` table to avoid table-name conflicts.

Verification already run:

```bash
yarn.cmd workspace @open-mercato/core typecheck
yarn.cmd db:generate
```

Both passed. `db:generate` reported `catalog: no changes`.

## Important Design Decision

The TPS option tree is not the same thing as product variants.

Use this mental model:

- Variant: a materialized SKU identity, useful for retail inventory, barcode, stock, and independent pricing.
- Option tree / modifier: choices selected during booking or service configuration, often affecting price and duration.

TPS services need the option tree model:

```text
product/service
  -> option group
    -> option
      -> child option group
        -> option
```

Do not collapse this into `CatalogProductVariant` unless implementing a separate retail variant use case.

## Remaining Work

### 1. Make TPS CLI Migration Safe

Current problem:

- `migrate-tps-products` and `migrate-tps-categories` still perform cleanup by default.
- Even though cleanup is now scoped by organization, it is still destructive.
- The commands should not delete live catalog data unless the operator explicitly opts in.

Implement:

- Add argument parsing for flags:
  - `--replace`: allow destructive cleanup.
  - optional later: `--dry-run`, `--currency VND`, `--skip-categories`, `--skip-products`.
- If existing data is detected and `--replace` is not passed:
  - log a clear error;
  - do not mutate data;
  - tell the operator to rerun with `--replace`.
- Before destructive cleanup, log a summary:
  - tenant ID;
  - organization ID;
  - estimated categories/products/variants/options to delete;
  - number of TPS categories/products to import.
- Keep cleanup scoped by `tenantId + organizationId`.
- Prefer transactions for each command, or at least document why full transaction is not used.
- Dispose the request container if it supports `dispose()`, following the pattern in `cli.ts` seed commands.

Files:

- `packages/core/src/modules/catalog/migrate-tps/categories.ts`
- `packages/core/src/modules/catalog/migrate-tps/products.ts`
- `packages/core/src/modules/catalog/cli.ts`

Suggested command UX:

```bash
yarn.cmd mercato catalog migrate-tps-categories <tenantId> <organizationId> --replace
yarn.cmd mercato catalog migrate-tps-products <tenantId> <organizationId> --replace
```

Acceptance criteria:

- Running without `--replace` does not delete existing data.
- Running with `--replace` only deletes rows for the given organization.
- Typecheck passes.
- Add focused unit tests if CLI helpers are extracted.

### 2. Extract TPS Mapping Into Testable Helpers

Current problem:

- `migrate-tps/products.ts` contains mapping logic inline.
- It uses several `any` types.
- Price and duration parsing are not covered by tests.

Implement:

- Extract pure helpers into a local file, for example:
  - `migrate-tps/mapping.ts`
  - or `migrate-tps/lib.ts`
- Make these helpers independent from MikroORM where possible:
  - `slugifyTpsText`
  - `parseTpsPrice`
  - `sumTpsPrices`
  - `extractTpsDuration`
  - `collectTpsSchemaGroups`
  - `enumerateTpsOptionPaths`
  - `hasNestedTpsOptionTree`
- Replace `any` with types from `migrate-tps/data/types.ts`.
- Represent gender price safely instead of `(p as any).men`.
- Normalize money values consistently as decimal strings.
- Normalize durations:
  - fixed duration: `durationValue + durationUnit`
  - range duration: `durationMin + durationMax + durationUnit`

Files:

- `packages/core/src/modules/catalog/migrate-tps/products.ts`
- `packages/core/src/modules/catalog/migrate-tps/data/types.ts`
- new tests under `packages/core/src/modules/catalog/migrate-tps/__tests__/`

Acceptance criteria:

- No new `any` in touched code.
- Tests cover:
  - fixed numeric price;
  - range price;
  - gender price with and without men price;
  - duration in item.duration;
  - duration parsed from name/description;
  - nested `nextGroups`;
  - option path enumeration.

### 3. Improve Option Tree Domain Surface

Current problem:

- CRUD routes for group and option are usable, but there is no domain command/API to sync a whole tree atomically.
- PCA ERP old code had a `syncOptionTree` service that did diff-based upsert and preserved IDs.
- Operis needs a command-style implementation that fits its audit/undo/mutation patterns.

Implement later, after CLI safety:

- Add a command for syncing a product option tree, for example:
  - command ID: `catalog.product_options.sync_tree`
  - route: `PUT /api/catalog/products/[id]/option-tree`
- It should:
  - load all existing groups/options for the product within `tenantId + organizationId`;
  - update existing group/option IDs if they belong to the product;
  - reject foreign UUIDs;
  - create new rows for draft IDs or missing IDs;
  - delete or soft-delete missing rows according to chosen semantics;
  - preserve stable IDs for unchanged nodes;
  - be atomic.
- Add tests equivalent to old PCA ERP `diff-based upsert` tests.

Old PCA ERP reference:

- `E:\Workspace\pca\pca_erp\apps\backend\src\modules\catalog\features\items\items.service.ts`
  - look for `syncOptionTree`.

Operis target files:

- `packages/core/src/modules/catalog/commands/`
- `packages/core/src/modules/catalog/api/products/[id]/option-tree/route.ts`
- `packages/core/src/modules/catalog/data/validators.ts`

Acceptance criteria:

- Stable IDs across update.
- Foreign group/option IDs rejected.
- Nested groups preserved.
- Missing nodes handled deliberately.
- Mutation guards are wired for custom write route.
- OpenAPI updated for PUT.

### 4. Standardize Option Tree UI

Current problem:

- `packages/core/src/modules/catalog/backend/catalog/products/[id]/options/page.tsx` is a useful first UI but not yet Operis-grade.
- Writes use direct `apiCall`.
- It uses native `<select>` and native `<input type="checkbox">`.
- Some placeholders and visible strings are hardcoded.
- Error handling is only logged, not surfaced well.

Implement:

- Use `useGuardedMutation(...).runMutation(...)` for POST/PUT/DELETE writes.
- Include `retryLastMutation` in relevant mutation context if required by the UI helper.
- Keep `apiCall`/`readApiResultOrThrow` for reads.
- Replace native controls with UI primitives from `@open-mercato/ui/primitives/*`.
- Move labels/placeholders/help text to catalog i18n files:
  - `packages/core/src/modules/catalog/i18n/en.json`
  - `pl.json`
  - `de.json`
  - `es.json`
  - `ko.json` if this repo keeps Korean synced.
- Add visible save/load/delete errors using existing backend UI patterns.
- Add `Cmd/Ctrl+Enter` submit and `Escape` cancel behavior for dialogs if not provided by primitives.
- Avoid hardcoded status colors and arbitrary Tailwind values.

Files:

- `packages/core/src/modules/catalog/backend/catalog/products/[id]/options/page.tsx`
- `packages/core/src/modules/catalog/i18n/*.json`

Acceptance criteria:

- Typecheck passes.
- i18n sync passes.
- No direct write mutation bypass for POST/PUT/DELETE in the page.
- UI remains accessible and stable for nested option trees.

### 5. Add API Isolation Tests

Current problem:

- `option-tree` route was fixed to scope by organization, but no regression test exists.

Implement tests for:

- same tenant, different organization cannot see option groups/options;
- missing organization context fails closed;
- product ID from another organization returns empty or not found, depending on current API convention.

Candidate location:

- `packages/core/src/modules/catalog/api/__tests__/`

Acceptance criteria:

- Test fails if route drops `organizationId` from filters.
- Test covers groups and options, not only groups.

### 6. Add TPS CLI / Mapping Tests

Implement tests for the migration helper layer once extracted:

- Category root/subcategory mapping.
- Product type mapping:
  - service -> `virtual`;
  - package -> `bundle`;
  - simple item -> `simple`;
  - configurable nested tree should stay service/option-tree, not explode into retail variants.
- Price parsing:
  - fixed;
  - range stores min as gross and original range metadata;
  - gender stores women price and metadata.
- Duration parsing:
  - fixed duration from source;
  - duration parsed from text.
- Nested option tree traversal.

Avoid tests that need seeded demo data. Keep fixtures local to the test.

### 7. Future Booking / Appointment Integration

Do this only after the catalog option tree surface is stable.

Needed behavior:

- Appointment/booking should read a nested option tree for service selection.
- Selected service/options should be snapshotted into booking/appointment lines.
- Snapshot should include:
  - product/service ID;
  - selected option IDs;
  - group name;
  - option name;
  - price flat/min/max;
  - duration;
  - currency;
  - sort order.
- Later catalog edits must not rewrite historical booking records.

Old PCA ERP references:

- `E:\Workspace\pca\pca_erp\apps\frontend\src\modules\appointment\features\appointments\utils\catalog-line.ts`
- `E:\Workspace\pca\pca_erp\apps\frontend\src\modules\appointment\features\appointments\components\CatalogServiceTreePicker.tsx`
- `E:\Workspace\pca\pca_erp\apps\backend\src\modules\appointment\features\public\public.service.ts`

## Known Risks

### Destructive Migration Cleanup

`Migration20260826015211_catalog.ts` now drops legacy option tables before creating the new `catalog_product_options` table. This is intentional because the legacy table name conflicts with the new entity model and no active entity currently maps to the legacy option/value tables.

Before applying this migration to a database with valuable legacy catalog option data, decide whether to:

- accept dropping legacy option data;
- back it up;
- write a data migration into the new option tree tables.

### CLI Import Is Still Destructive By Default

The CLI migrate commands still need a `--replace` guard. Do this before using them on any non-disposable database.

### Option Tree Has No Atomic Sync Yet

Manual CRUD works, but whole-tree editing/import is not yet modeled as an atomic command. Booking integration should wait until stable-ID sync exists.

### UI Is Functional But Not Final

The option tree page is useful for manual inspection and editing, but it still needs mutation guards, DS cleanup, i18n cleanup, and error states.

## Suggested Next Agent Prompt

Use this exact short prompt for the next agent:

```text
Read AGENTS.md, packages/core/AGENTS.md, packages/core/src/modules/catalog/AGENTS.md, and CATALOG_TPS_MIGRATION_NEXT_STEPS.md. Implement section "1. Make TPS CLI Migration Safe" first. Keep the change focused. Do not apply migrations locally. Run yarn.cmd workspace @open-mercato/core typecheck and relevant focused tests.
```

## Validation Commands

Use the smallest relevant set for each change.

For CLI/mapping work:

```bash
yarn.cmd workspace @open-mercato/core typecheck
yarn.cmd workspace @open-mercato/core test --runInBand --testPathPattern=catalog
```

For schema changes:

```bash
yarn.cmd db:generate
yarn.cmd workspace @open-mercato/core typecheck
```

For i18n/UI work:

```bash
yarn.cmd i18n:check-sync
yarn.cmd workspace @open-mercato/core typecheck
```

If PowerShell blocks `yarn`, use `yarn.cmd`.
