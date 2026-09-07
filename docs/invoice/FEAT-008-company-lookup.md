# FEAT-008 - Company Lookup

## Description
Invoice module exposes a module-gated route over the shared company lookup service. It looks up government identifiers such as VN MST or SG UEN and returns public registry data for autofill.

## Purpose
Autofill partner company details during invoice creation while keeping lookup providers/cache centralized.

## User/business value
- Fewer manual typing errors for company names.
- Shared cache prevents repeated external lookups.
- Same lookup rule can serve invoice, CRM, and PCA tenant creation.

## Entry points
- API:
  - `GET /invoice/company-lookup/:taxCode?country=...`
- Frontend:
  - `InvoiceFormPage`
  - `useInvoiceCompanyLookup`
  - `RegistryHint`

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/company-lookup/company-lookup.controller.ts`
  - `apps/backend/src/modules/invoice/features/company-lookup/company-lookup.module.ts`
  - shared dependency `apps/backend/src/common/company-lookup/*`
- Frontend:
  - `apps/frontend/src/modules/invoice/features/partners/api/company-lookup.api.ts`
  - `apps/frontend/src/modules/invoice/features/partners/hooks/use-company-lookup.ts`
- Shared contracts:
  - `packages/shared-types/src/company-lookup.ts`
  - referenced from `packages/shared-types/src/invoice.ts`.

## Dependencies
- DB: `invoice.company_registry` cache table.
- Services: `CompanyLookupService`, jurisdiction providers.
- External APIs: VietQR provider, data.gov.sg provider, depending on country.
- Infra: throttle decorator, shared lookup module.

## Inputs
- Identifier path param.
- Query country, default handled by shared lookup DTO/service.

## Outputs
- `CompanyLookupResult`.

## Side effects
- Shared service may read/write `invoice.company_registry` cache.
- No invoice/partner row is created by lookup itself.

## Failure behavior
- Route requires authenticated tenant with invoice module access.
- Route is rate-limited by shared company lookup throttle.
- Provider outage behavior is owned by `CompanyLookupService` and can serve stale cache.

## Retry behavior
- Frontend lookup is debounced/query-based.
- Shared service/provider owns any retry/rate-limit behavior.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: lookup is autofill-only, not persisted as invoice truth.
- `DATA_DEPENDENT`: `invoice.company_registry` cache and TTL.
- `INFRA_DEPENDENT`: external providers, throttling, shared service module.
- `UI_DEPENDENT`: registry hint/autofill in manual invoice form.

## Capability trace

### CAP-008 - invoice-company-lookup

#### FLOW-001 - Lookup partner company
- Trigger: user enters registration/tax code and country in manual invoice form.
- Entry point: `useInvoiceCompanyLookup`.
- Calls: `invoiceCompanyLookupApi.lookup` -> `GET /invoice/company-lookup/:taxCode?country=` -> `CompanyLookupController.lookup` -> `CompanyLookupService.lookup`.
- Execution: shared service validates/routs by jurisdiction, checks cache, calls provider if needed, returns normalized public registry result.
- Retry: frontend can refetch; provider/cache rules live in shared service.
- Idempotency: lookup is read/autofill from user perspective; cache write is keyed by identifier.
- Error handling: provider-specific failures are abstracted by shared service.
- Other: invoice create still sends explicit partner fields; lookup does not create invoice company.

## Legacy/dead logic check
- `CompanyLookupResult` moved out of `invoice.ts` to shared company lookup contract. Keep imports from package root/shared file; do not reintroduce invoice-local shape.

## Evidence
- `apps/backend/src/modules/invoice/features/company-lookup/company-lookup.controller.ts`
- `apps/backend/src/common/company-lookup/*`
- `apps/backend/src/infra/throttler/throttle-policy.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `packages/shared-types/src/invoice.ts`
