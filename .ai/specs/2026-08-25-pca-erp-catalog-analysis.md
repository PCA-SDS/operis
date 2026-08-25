# Comprehensive Analysis: Catalog Module — PCA ERP (Legacy System)

> Extracted directly from `apps/backend/prisma/schema.prisma`
> Schema namespace: `catalog`

---

## 1. Architectural Overview

The Catalog Module of PCA ERP is designed using a **Deep Recursive Tree** model. The entire service menu of a salon/spa is represented as a single hierarchical tree, from broad categories down to the smallest detailed options.

```
CatalogCategory (Category – Recursive Tree)
    └── CatalogItem (Service/Product)
            ├── CatalogOptionGroup (Option Group – attached to Item)
            │       └── CatalogOption (Specific Choice – has its own price)
            │               └── CatalogOptionGroup (Deeper nested group – attached to Option)
            │                       └── CatalogOption (Next choice...)
            │                               └── ... (infinite recursion)
            ├── CatalogItemConstraint (Constraint between Item/Option)
            ├── CatalogBranchOverride (Price/Time override per Branch)
            └── CatalogPriceAttribute (Price based on customer attributes)
```

**Core Concept:** A `CatalogOptionGroup` can be attached to a `CatalogItem` (first level) OR attached to a `CatalogOption` (deeper level, via `parentOptionId`). This is the mechanism that creates infinitely nested option trees.

---

## 2. Entity Details

### 2.1 `CatalogCategory` — Category
- **Table:** `catalog.catalog_categories`
- The highest level of classification. Supports self-referencing (parent/child) to form a tree.

### 2.2 `CatalogItem` — Service / Product
- **Table:** `catalog.catalog_items`
- The central sales unit — equivalent to `Product` in Open Mercato.
- Types: `service`, `product`, `package`, `subscription`, `voucher`.

### 2.3 `CatalogOptionGroup` — Option Group (Core of the Tree)
- **Table:** `catalog.catalog_option_groups`
- Creates the depth of the option tree. Can be attached to an Item (level 1) or an Option (level 2+).

### 2.4 `CatalogOption` — Specific Choice
- **Table:** `catalog.catalog_options`
- A specific choice within an `OptionGroup`. **Important:** Options contain their own prices (`priceFlat`) and durations, not Items. They can be leaf nodes or intermediate nodes (having `nextGroups`).

### 2.5 `CatalogItemConstraint` — Constraints
- Defines business rules between Items or Options when selected together.
- Types: `conflicts_with_item`, `requires_item`, `mutually_exclusive_item`, `includes_item`.

### 2.6 `CatalogBranchOverride` — Branch Override
- Allows a Branch to override prices, durations, or hide services compared to the original configuration.

### 2.7 `CatalogPriceAttribute` — Price by Attribute
- Allows price adjustments based on customer attributes (e.g., gender).

---

## 3. Strengths and Weaknesses of the Legacy Architecture

### ✅ Strengths:
- **Intuitive:** The hierarchical tree directly reflects the UI experience.
- **Infinite Flexibility:** The depth of the tree can be expanded arbitrarily without schema changes.
- **Simple Business Logic:** Prices are stored directly on the Option, making bill calculation easy (`SUM(priceFlat)`).

### ❌ Weaknesses:
- **Heavy Queries:** Fetching the entire tree for an Item requires recursive JOINs or eager-loading multiple loops.
- **Lack of Sales Channels:** No concept of "which channel it is sold on" — the entire catalog is global per tenant.
- **Lack of Tier Pricing:** No pricing by quantity, customer group, or time.
- **Not Scalable for eCommerce:** Lacks Barcodes, SKU level for variants, no inventory.
- **Constraints only at Catalog level:** Rule logic is in the DB but lacks an enforcement engine — Frontend must self-check.
