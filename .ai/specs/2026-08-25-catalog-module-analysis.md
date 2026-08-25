# Comprehensive Analysis: Catalog Module – Open Mercato

> Extracted directly from source code at `packages/core/src/modules/catalog/`.

---

## 1. Architectural Overview

The Catalog Module is the **central product/service data hub** of the entire system. It is organized in a tiered model:

```
CatalogProductCategory (Category – Tree)
    └── CatalogProduct (Product – Core)
            ├── CatalogProductVariant (Variant)
            │       ├── CatalogProductPrice (Variant Price)
            │       └── CatalogProductVariantRelation (Bundle/Grouped Link)
            ├── CatalogOffer (Sales Channel Edition)
            │       └── CatalogProductPrice (Offer Price)
            ├── CatalogProductCategoryAssignment (Category Assignment – Many:Many)
            ├── CatalogProductTagAssignment (Tag Assignment – Many:Many)
            ├── CatalogProductUnitConversion (Unit Conversion)
            ├── CatalogProductConstraint (Product Constraint)
            └── CatalogOptionSchemaTemplate (Configurable Option Schema)
```

---

## 2. Entity Details

### 2.1 `CatalogProduct` — Product (Core)
- **Table:** `catalog_products`
- The central unit. All other entities revolve around it.
- Types: `simple`, `configurable`, `virtual`, `downloadable`, `bundle`, `grouped`.

### 2.2 `CatalogProductCategory` — Category (Hierarchical Tree)
- **Table:** `catalog_product_categories`
- **Architecture: Materialized Path Tree** — stores the full hierarchy path in each row to avoid SQL recursion (`treePath`, `ancestorIds`, `descendantIds`).

### 2.3 `CatalogProductVariant` — Product Variant
- **Table:** `catalog_product_variants`
- A specific version of a Product. For `configurable` products, each Option combination is a separate Variant.
- Contains its own SKU, barcode, and `optionValues` (e.g., `{ "size": "L", "color": "red" }`).

### 2.4 `CatalogOffer` — Sales Channel Edition
- **Table:** `catalog_product_offers`
- Represents the **appearance of a Product on a specific Sales Channel**.
- Allows customizing display content (name, description, image) for each channel while sharing the same root Product.

### 2.5 `CatalogProductPrice` — Price
- **Table:** `catalog_product_variant_prices`
- The most flexible pricing engine. A price record stores not just a number but also the **Condition of Application (Scope)**.
- **Scopes:** `channelId`, `userId`, `userGroupId`, `customerId`, `customerGroupId`, `minQuantity`, `maxQuantity`, `startsAt`, `endsAt`.

### 2.6 `CatalogProductConstraint` — Product Constraint
- **Table:** `catalog_product_constraints`
- Defines **business rules** on relationships between products when selected together. Used to recreate the "nested selection tree" logic of the legacy system in a flat format.
- Types: `requires`, `conflicts_with`, `mutually_exclusive`, `includes`.

### 2.7 `CatalogOptionSchemaTemplate` — Option Schema
- **Table:** `catalog_option_schema_templates`
- Defines the Options structure for `configurable` products. Stored as a **Flat JSON Schema**.

---

## 3. Comparison with Legacy PCA ERP

| Feature | PCA ERP (Legacy) | Open Mercato (New) |
|-----------|-------------|---------------------|
| Product Classification | `CatalogCategory` (Recursive Tree) | `CatalogProductCategory` (Materialized Path Tree) |
| Basic Product Unit | `CatalogItem` | `CatalogProduct` |
| Nested Options | `CatalogOptionGroup` (infinite recursion) | `OptionSchema` (flat) + `Variants` (combinations) |
| Selection Constraints | Implicit (within the tree) | Explicit `CatalogProductConstraint` |
| Price by Channel | `CatalogBranchOverride` | `CatalogOffer` + `CatalogProductPrice` (scope) |
| Price by Customer | Not readily available | `CatalogProductPrice.customerId` |
| Price by Quantity | Not readily available | `CatalogProductPrice.minQuantity` / `maxQuantity` |
