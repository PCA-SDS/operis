# Catalog Scheduling Integration

## Overview
This document details the design pattern for reading catalog options (specifically `duration_value` and `duration_unit`) from a booking or scheduling module. 

While the catalog module is primarily responsible for defining the pricing and structure of what is sold, for service-oriented businesses (like salons, repair shops, and clinics), the catalog also dictates how much **time** a service takes.

## Core Concepts

### Option Tree Duration
The option tree atomic sync command supports adding durations to individual `CatalogProductOption` entries via the following fields:
- `durationValue` (integer)
- `durationUnit` (`'minute' | 'hour' | 'day'`)

### Calculating Total Service Duration
When a booking is created, the scheduling module should:
1. Identify the base product (if the product itself has a base duration, or it relies purely on options).
2. Sum the `durationValue` of all selected `CatalogProductOption` items in the customer's cart or selected service list.
3. Normalize the units (e.g. converting hours to minutes) to get the total block length.

```typescript
function calculateTotalDuration(selectedOptions: CatalogProductOption[]): number {
  let totalMinutes = 0;
  for (const opt of selectedOptions) {
    if (!opt.durationValue) continue;
    if (opt.durationUnit === 'hour') {
      totalMinutes += opt.durationValue * 60;
    } else if (opt.durationUnit === 'day') {
      totalMinutes += opt.durationValue * 1440;
    } else {
      totalMinutes += opt.durationValue;
    }
  }
  return totalMinutes;
}
```

## Integration Pattern

### 1. Loose Coupling
The `Catalog` module **must not** have direct foreign keys to scheduling/booking entities. The Catalog defines the schema; the Booking module references `CatalogProductOption` IDs as loosely coupled identifiers.

### 2. Snapshots
When a booking is finalized, the Booking module should snapshot the duration. If the catalog manager later changes the `durationValue` of a `CatalogProductOption`, existing finalized bookings should not automatically expand or shrink, as this could lead to schedule conflicts.

### 3. API Boundary
The Scheduling UI will use the standard Catalog Option Tree API (`GET /api/products/[id]/option-tree`) to fetch options, compute the required time block, and then query availability from the scheduling backend based on that computed block.
