# FEAT-003 - Partner Payment Terms

## Description
Partner master là danh sách công ty tenant giao dịch trong invoice module. Mỗi partner có default payment terms để server tự derive due date khi tạo/import invoice mà không có dueDate rõ ràng.

## Purpose
Giữ một nguồn truth cho partner company, search được, và cấu hình số ngày thanh toán mặc định theo partner.

## User/business value
- Tự động đặt due date đúng theo từng partner.
- Settings page giúp finance team cập nhật terms mà không sửa từng invoice.
- Create form có thể match partner đã có để seed dueDate.

## Entry points
- API:
  - `GET /invoice/partners`
  - `GET /invoice/partners/match`
  - `PATCH /invoice/partners/:id`
- Frontend:
  - `/invoice/settings/payment-terms`
  - `InvoiceFormPage` partner match.

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/partners/partners.controller.ts`
  - `apps/backend/src/modules/invoice/features/partners/partners.service.ts`
  - `apps/backend/src/modules/invoice/features/partners/dto/*`
- Frontend:
  - `apps/frontend/src/modules/invoice/features/partners/api/partners.api.ts`
  - `apps/frontend/src/modules/invoice/features/partners/hooks/*`
  - `apps/frontend/src/modules/invoice/features/partners/components/PaymentTermsSection.tsx`
- Shared contracts:
  - `packages/shared-types/src/invoice.ts`

## Dependencies
- DB: `invoice.companies` with `default_due_days`, `name_source_date`, `search_text`.
- Shared infra: Prisma, `common/search.ts`, pagination helper, TanStack Query.
- Upstream writers: manual invoice create/update and GDT sync create/update partner rows.

## Inputs
- List query: page, pageSize, search.
- Match query: name, taxCode.
- Update body: `defaultDueDays: number | null`.

## Outputs
- `InvoicePartnersListResponse`
- `MatchPartnerResponse`
- `InvoicePartnerListItemDto`

## Side effects
- `PATCH /partners/:id` updates partner default terms.
- Create/import invoice later reads those terms to derive due dates.

## Failure behavior
- List and update are tenant-scoped.
- Foreign/missing partner update returns 404 via P2025 translation.
- Match by registration/tax code does not fallback to name on miss.

## Retry behavior
- No backend retry.
- Frontend invalidates partner lists, invoice lists/details after terms update.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: taxCode identity vs name fallback, defaultDueDays due-date derivation, latest-name-by-date from sync.
- `DATA_DEPENDENT`: partner table, unique `(tenantId, taxCode)`, searchText trigger/index, defaultDueDays CHECK.
- `INFRA_DEPENDENT`: Prisma pagination/search.
- `UI_DEPENDENT`: payment terms settings page and create form seeding.

## Capability trace

### CAP-003 - partner-payment-terms

#### FLOW-001 - List/search partners
- Trigger: user opens payment terms settings.
- Entry point: `PaymentTermsSection` -> `usePartners`.
- Calls: `invoicePartnersApi.list` -> `GET /invoice/partners` -> `PartnersService.list` -> `searchTextFilters` -> Prisma findMany/count -> `buildListResponse`.
- Execution: partners are ordered by name asc and include invoice count.
- Retry: UI retry button refetches.
- Idempotency: read-only.
- Error handling: normal auth/module guards.
- Other: search is diacritic-insensitive via DB-maintained `search_text`.

#### FLOW-002 - Update default terms
- Trigger: user changes days input and blurs/presses Enter.
- Entry point: `PaymentTermsSection.TermsInput` -> `useUpdatePartnerTerms`.
- Calls: `PATCH /invoice/partners/:id` -> `PartnersService.updateTerms` -> `invoiceCompany.update({ where: { id, tenantId } })`.
- Execution: set number of days or clear to null. Later invoice create/import uses this when no explicit due date exists.
- Retry: user can retry manually.
- Idempotency: setting same value again is harmless.
- Error handling: invalid range rejected by DTO/DB CHECK; foreign id returns 404.
- Other: frontend also validates 1..`INVOICE_MAX_DUE_DAYS`.

#### FLOW-003 - Match partner during manual invoice form
- Trigger: user types partner name/registration number in create form.
- Entry point: `usePartnerMatch`.
- Calls: `GET /invoice/partners/match?name=&taxCode=` -> `PartnersService.match`.
- Execution: if taxCode present, match only by `(tenantId,taxCode)`. If absent, match by case-insensitive name inside tenant.
- Retry: query refetch/debounce.
- Idempotency: read-only.
- Error handling: empty name without taxCode returns null.
- Other: matched default terms can auto-seed dueDate if user has not touched terms.

## Legacy/dead logic check
- Partner `defaultDueDays` default is 30 in schema, while manual create form initial default is 45 when no matched partner. This is current behavior and should be preserved unless product changes it.
- Synthetic partner tax codes `auto:<uuid>` are internal keys; they should not be shown as real identifiers.

## Evidence
- `apps/backend/src/modules/invoice/features/partners/partners.service.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `packages/shared-types/src/invoice.ts`
- `apps/frontend/src/modules/invoice/pages/InvoiceSettingsPaymentTermsPage.tsx`
- `packages/core/src/modules/invoice/services/__tests__/partner-terms-service.test.ts`
- `packages/core/src/modules/invoice/data/__tests__/validators.test.ts`
- `packages/core/src/modules/invoice/api/partners/__tests__/partners.route.test.ts`
