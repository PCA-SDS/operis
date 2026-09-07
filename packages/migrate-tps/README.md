# @open-mercato/migrate-tps

One-shot importer that seeds a tenant's catalog from the TPS service menu.

The menu itself (`src/modules/migrate_tps/data/serviceMenu.ts`) is one client's
data, which is why it lives in its own package instead of `@open-mercato/core`.

```bash
yarn mercato migrate_tps categories <tenantId> <organizationId> [--replace]
yarn mercato migrate_tps products <tenantId> <organizationId> [--replace]
```

`--replace` wipes the existing categories for that tenant + organization before
importing. Without it the command refuses to run when data is already present.
