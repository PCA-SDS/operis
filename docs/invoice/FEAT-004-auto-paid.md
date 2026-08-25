# FEAT-004 - Auto-Paid Companies

## Description
Tenant có thể cấu hình tax code của supplier mà mọi AP invoice từ supplier đó được xem là đã paid tự động.

## Purpose
Bypass flow "Paid?" email confirmation cho các supplier mà payment luôn được xử lý ngoài hệ thống.

## User/business value
- Giảm thao tác xác nhận payment cho vendor quen thuộc.
- Có thể đảo ngược auto-paid trên từng invoice hoặc remove rule để revert các invoice do rule auto-settled.

## Entry points
- API:
  - `GET /invoice/auto-paid`
  - `GET /invoice/auto-paid/candidates`
  - `POST /invoice/auto-paid`
  - `DELETE /invoice/auto-paid/:id`
  - `PATCH /invoice/invoices/:id/reverse-auto-paid`
- Frontend:
  - `/invoice/settings/auto-paid`
  - invoice list/detail auto-paid marker.
- Internal:
  - `AutoPaidService.isAutoPaid` during manual invoice create.
  - `AutoPaidService.applyAll` after sync.

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/auto-paid/auto-paid.controller.ts`
  - `apps/backend/src/modules/invoice/features/auto-paid/auto-paid.service.ts`
  - `apps/backend/src/modules/invoice/features/invoices/invoices.service.ts#reverseAutoPaid`
- Frontend:
  - `apps/frontend/src/modules/invoice/features/auto-paid/*`
  - `apps/frontend/src/modules/invoice/features/invoices/hooks/use-reverse-auto-paid.ts`
- Shared contracts:
  - `packages/shared-types/src/invoice.ts`

## Dependencies
- DB: `invoice.auto_paid_tax_codes`, `invoice.invoices`.
- Infra: Prisma, raw SQL update statements.
- Related: Sync processor calls `applyAll`.

## Inputs
- Tax code string.
- Auto-paid row id.
- Invoice id for one-off reverse.

## Outputs
- `InvoiceAutoPaidTaxCodeDto[]`
- `InvoiceAutoPaidCandidateDto[]`
- `InvoiceDetailDto` for reverse.

## Side effects
- Adding rule upserts tax code and settles matching AP invoices where not settled and not excluded.
- Removing rule deletes row and reverts invoices where `autoSettled = true`.
- Manual reverse sets invoice back to unpaid and stamps `autoPayExcluded = true`.

## Failure behavior
- Empty tax code rejected.
- Remove missing/foreign rule returns 404.
- Reverse only accepts AP invoices with `autoSettled = true`.

## Retry behavior
- Upsert makes adding the same code safe.
- No automatic backend retry.
- Frontend invalidates auto-paid, lists, details, summary.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: AP-only auto settlement, reversible rule behavior, per-invoice exclusion after manual reverse.
- `DATA_DEPENDENT`: `auto_paid_tax_codes`, invoice `autoSettled`, `autoPayExcluded`, paid/outstanding fields.
- `INFRA_DEPENDENT`: raw SQL updates; needs careful port to new DB layer.
- `UI_DEPENDENT`: settings page, marker and reverse confirmation.

## Capability trace

### CAP-004 - auto-paid

#### FLOW-001 - List rules and candidates
- Trigger: user opens auto-paid settings.
- Entry point: `AutoPaidSection` -> `useAutoPaid` / `useAutoPaidCandidates`.
- Calls list: `GET /invoice/auto-paid` -> `AutoPaidService.list` -> fetch rows -> group invoice counts by sellerTaxCode.
- Calls candidates: `GET /invoice/auto-paid/candidates` -> partners with AP invoices and non-synthetic taxCode -> group counts.
- Execution: candidates are existing AP partner companies not already on list.
- Retry: UI retry/refetch.
- Idempotency: read-only.
- Error handling: normal auth/module guards.
- Other: `auto:` synthetic keys excluded from candidates.

#### FLOW-002 - Add auto-paid rule
- Trigger: user picks candidate or types tax code.
- Entry point: `invoiceAutoPaidApi.add`.
- Calls: `POST /invoice/auto-paid` -> trim taxCode -> `invoiceAutoPaidTaxCode.upsert` -> `settleTaxCode`.
- Calls settle: raw SQL updates AP invoices matching seller_tax_code, not settled, not auto_pay_excluded.
- Execution: set SETTLED, paidAmount=totalWithVat, outstanding=0, nextDueDate=null, hasPaid=true, autoSettled=true.
- Retry: upsert means same taxCode does not duplicate.
- Idempotency: repeated add converges to same rule and same invoice state.
- Error handling: empty code 400.
- Other: returns count of matching AP invoices.

#### FLOW-003 - Remove auto-paid rule
- Trigger: user confirms remove.
- Entry point: `invoiceAutoPaidApi.remove`.
- Calls: `DELETE /invoice/auto-paid/:id` -> find row by id+tenant -> delete -> `revertTaxCode`.
- Execution: reverts AP invoices with same sellerTaxCode and `autoSettled=true` to UNSETTLED, paid=0, outstanding=total, nextDueDate=dueDate, hasPaid=false, autoSettled=false.
- Retry: after delete, repeat returns 404.
- Idempotency: first call changes state; later calls no-op by 404.
- Error handling: missing row 404.
- Other: only invoices originally auto-settled by rule are reverted.

#### FLOW-004 - Reverse one auto-paid invoice
- Trigger: user clicks auto-paid marker on invoice.
- Entry point: `useReverseAutoPaid`.
- Calls: `PATCH /invoice/invoices/:id/reverse-auto-paid` -> load invoice -> validate AP + autoSettled -> update invoice.
- Execution: invoice becomes unpaid and `autoPayExcluded=true`, so future auto-pay passes skip it.
- Retry: second call returns 400 because invoice is no longer autoSettled.
- Idempotency: business effect is one-time.
- Error handling: AR or non-auto-settled invoice returns 400.
- Other: useful after sync incorrectly auto-settled an invoice.

## Legacy/dead logic check
- Auto-paid uses raw SQL because it updates many rows with DB columns. Port should review SQL dialect and tenant scoping, not change semantics.
- There is no DTO-level tax-code shape beyond max length/required; current behavior accepts free-form supplier identifiers.

## Evidence
- `apps/backend/src/modules/invoice/features/auto-paid/auto-paid.service.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `packages/shared-types/src/invoice.ts`
