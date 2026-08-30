# FEAT-006 - Partner Company Emails

## Description
Danh sách email recipient đã dùng cho từng partner company trong invoice module. Dùng cho send invoice và payment confirmation.

## Purpose
Gợi ý lại email đã dùng gần đây để user không phải nhập lại.

## User/business value
- Giảm lỗi nhập email.
- Tăng tốc gửi invoice và request confirmation.

## Entry points
- API:
  - `GET /invoice/companies/:companyId/emails`
  - `DELETE /invoice/companies/:companyId/emails/:emailId`
- Internal:
  - `CompanyEmailsService.record(companyId,email)` from invoice send and payment confirmation request.
- Frontend:
  - `CompanyEmailField`
  - `SendInvoicePanel`
  - `PaidConfirmDialog`

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/company-emails/company-emails.controller.ts`
  - `apps/backend/src/modules/invoice/features/company-emails/company-emails.service.ts`
- Frontend:
  - `apps/frontend/src/modules/invoice/features/invoices/components/CompanyEmailField.tsx`
  - `apps/frontend/src/modules/invoice/features/invoices/hooks/use-company-emails.ts`
- Shared contracts:
  - `packages/shared-types/src/invoice.ts`

## Dependencies
- DB: `invoice.company_emails`, `invoice.companies`.
- Infra: Prisma, TanStack Query.

## Inputs
- companyId, emailId.
- Email string recorded internally.

## Outputs
- `InvoiceCompanyEmailDto[]`
- void for delete.

## Side effects
- Record upserts `(companyId,email)`, updating `updatedAt`.
- Delete removes matching email row.

## Failure behavior
- Public CRUD checks company belongs to tenant first.
- Listing/removing a foreign company returns 404.
- Removing email uses deleteMany and does not throw if email already gone after company check.
- Empty email record is ignored.

## Retry behavior
- Record upsert is naturally retry-safe.
- UI invalidates company email query after send/request/delete.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: per-partner email memory, most-recently-used order.
- `DATA_DEPENDENT`: unique `(company_id,email)`, cascade from partner company.
- `INFRA_DEPENDENT`: Prisma upsert/deleteMany.
- `UI_DEPENDENT`: email autocomplete field.

## Capability trace

### CAP-006 - company-email-memory

#### FLOW-001 - List saved emails
- Trigger: user opens send/request dialog.
- Entry point: `CompanyEmailField` -> `useCompanyEmails`.
- Calls: `GET /invoice/companies/:companyId/emails` -> `assertCompany` -> `invoiceCompanyEmail.findMany(orderBy updatedAt desc)` -> DTO.
- Execution: only emails for this partner company are returned.
- Retry: query can refetch.
- Idempotency: read-only.
- Error handling: company not in tenant returns 404.
- Other: no email is created from list flow.

#### FLOW-002 - Record email after successful send/request
- Trigger: `sendInvoice` or `request payment confirmation` succeeds.
- Entry point: `CompanyEmailsService.record`.
- Calls: trim email -> `invoiceCompanyEmail.upsert({ companyId_email })`.
- Execution: new email created or existing email touched via update.
- Retry: safe to call multiple times.
- Idempotency: unique `(companyId,email)`.
- Error handling: caller catches/logs failures so main send/request flow can still succeed.
- Other: record does not tenant-check; callers must pass a company id already loaded from tenant-scoped invoice.

#### FLOW-003 - Remove saved email
- Trigger: user deletes suggestion.
- Entry point: `useCompanyEmails.removeEmail`.
- Calls: `DELETE /invoice/companies/:companyId/emails/:emailId` -> `assertCompany` -> `deleteMany({ id,emailId,companyId })`.
- Execution: removes the suggestion only.
- Retry: repeat after delete is effectively no-op after company check.
- Idempotency: deleteMany count is ignored.
- Error handling: foreign company returns 404.
- Other: does not affect historical sent emails or payment confirmations.

## Legacy/dead logic check
- This is invoice-local email memory, separate from CRM contacts. Do not merge during migration unless product decides one shared contact model.

## Evidence
- `apps/backend/src/modules/invoice/features/company-emails/company-emails.service.ts`
- `apps/backend/prisma/schema.prisma`
- `packages/shared-types/src/invoice.ts`
