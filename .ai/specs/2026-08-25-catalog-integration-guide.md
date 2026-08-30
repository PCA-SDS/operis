# Catalog Integration Guide: PCA ERP → Open Mercato

> **Objective:** Read all Catalog data from the PCA ERP database and accurately recreate it in Open Mercato via REST APIs, ensuring no data loss and maintaining backward compatibility with the existing booking system.

---

## 1. Strategy Overview

### 1.1 Migration Philosophy

The legacy ERP system stores the catalog using a **deep recursive tree** model (Category → Item → OptionGroup → Option → ...). Open Mercato uses a **flat combinatorial** model (Category Tree + Product + Variant). The conversion is not a simple 1-to-1 mapping — it requires a crucial **"Tree Flattening"** step in between.

```
LEGACY ERP                          OPEN MERCATO
──────────────────────────────────────────────────────────────
CatalogCategory           →  CatalogProductCategory
CatalogItem               →  CatalogProduct
CatalogItem.type          →  CatalogProduct.productType
OptionGroup[L1..Ln] tree  →  CatalogOptionSchemaTemplate (flat)
Option (final leaf)       →  CatalogProductVariant
Option.priceFlat (accum)  →  CatalogProductPrice
CatalogItemConstraint     →  CatalogProductConstraint
CatalogBranchOverride     →  CatalogOffer + Price.channelId
```

---

## 2. Detailed Phases

### Phase 1: Migrate Categories
**Approach**: Build a one-off CLI command (`packages/cli/src/commands/catalog-migrate-pca.ts`) that connects directly to the legacy ERP database via `LEGACY_DB_URL`.

**Schema Changes**: 
- Add a `metadata` (JSONB) column to `CatalogProductCategory` in Open Mercato to hold legacy business logic fields without polluting the core schema.

**Mapping Logic**:
- Map `CatalogCategory` to `CatalogProductCategory`.
- Preserve the legacy UUID in `metadata.legacy_id`.
- Preserve booking-specific UI flags (`requirement`, `selectMode`, `sortOrder`, `isActive`, `note`, `translations`) inside the `metadata` JSON object.
- **Drop** the legacy `bundle` field from categories as it violates product-level design.
- Traverse the tree correctly (parents first) so OM can automatically calculate `treePath` and `depth`.

### Phase 2: Migrate Items → Products
- Map `CatalogItem` to `CatalogProduct`.
- Map types (e.g., `service` → `virtual`, `product` → `simple`).
- Items with `OptionGroups` become `configurable` Products.

### Phase 3: Option Tree Flattening (The Most Complex Step)
This is the heart of the migration. The goal is to convert the recursive tree of the legacy ERP into a pair of `(OptionSchemaTemplate, [Variants])` in Open Mercato.

**Step 3.1: Build Flat OptionSchema**
Extract all unique dimensions (OptionGroups) into a flat schema.

**Step 3.2: Enumerate all Valid Paths**
Traverse the recursive tree to find all paths from root to leaf. Each path represents one valid combination of choices.

**Step 3.3: Create Variants and Prices**
Each valid path becomes 1 `CatalogProductVariant` and 1 `CatalogProductPrice`. The price is the `SUM(priceFlat)` of all options along that path.

### Phase 4: Migrate Constraints
Map the 4 types of constraints from ERP to Open Mercato:
- `conflicts_with_item` → `conflicts_with`
- `requires_item` → `requires`
- `mutually_exclusive_item` → `mutually_exclusive`
- `includes_item` → `includes`

Since Open Mercato only supports constraints at the Product/Variant level, map legacy `sourceOptionId`/`targetOptionId` to their corresponding flattened `VariantId`s.

### Phase 5: Migrate Branch Overrides
Legacy `CatalogBranchOverride` served to hide services or override prices per branch.
In Open Mercato, this is handled by **Offer + Price scoped by Channel**:
- Map Branch to `SalesChannel`.
- Create a `CatalogOffer` for that channel to control visibility.
- Create a `CatalogProductPrice` with `channelId` to override the price.

---

## 3. Post-Migration Verification

- **Quantitative:** Check if the number of legacy Items matches new Products, and valid paths match the number of Variants.
- **Price Integrity:** Verify that the sum of prices on a legacy path exactly matches the `unitPriceGross` of the corresponding Variant.
- **Constraints:** Ensure every legacy constraint has a mapped constraint pointing to the correct Variants.
