# @open-mercato/migrate-tps

One-shot importer that seeds a tenant's catalog from the TPS service menu.

The menu itself (`src/modules/migrate_tps/data/serviceMenu.ts`) is one client's
data, which is why it lives in its own package instead of `@open-mercato/core`.

CSV fallback files live in the package-level `data/` directory:

- `data/tps_floors.csv`
- `data/tps_seat_types.csv`
- `data/tps_seats.csv`

The build copies those files to `dist/data/`. Keep CSV exports out of
`src/modules/migrate_tps/data/`; that directory is for module source data such
as locales and imported TypeScript fixtures.

```bash
yarn mercato migrate_tps categories <tenantId> <organizationId> [--replace]
yarn mercato migrate_tps products <tenantId> <organizationId> [--replace]
yarn mercato migrate_tps resources <tenantId> <organizationId> [--location <location>] [--replace]
yarn mercato migrate_tps people <tenantId> <rootOrganizationId> [--replace] [--staff-only]
```

`people` imports TPS customers once at tenant level under the root organization,
then creates one staff membership per branch for TPS accounts with the `STAFF`
role. TPS accounts are linked to tenant-wide Operis users, and missing users are
created from the TPS bcrypt hash. TPS `job_roles` are imported as branch-scoped
`StaffTeamRole` records and assigned to each matching membership (for example,
an account with `LASH` and `NAILS` receives both roles). Use `includeUnlinked=true`
when loading the assignable staff roster. Pass `--staff-only` to skip customer
writes.

`--replace` wipes the existing categories for that tenant + organization before
importing. Without it the command refuses to run when data is already present.
