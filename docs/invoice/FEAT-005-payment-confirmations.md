# FEAT-005 - Payment Confirmations

## Description
AP payment settlement qua magic link. Tenant buyer bấm "Paid?", nhập email supplier/payee. Supplier mở public link để confirm/reject đã nhận tiền. Với AR tương ứng, tenant seller có thể accept/reject incoming payment claim trong app.

## Purpose
Không cho AP tự mark paid không có xác nhận, trừ auto-paid. Magic link cho counterparty xác nhận mà không cần account.

## User/business value
- Tăng độ tin cậy của trạng thái paid cho AP.
- Hỗ trợ confirmation cho cả whole invoice và từng installment.
- Hai bên có cùng invoice identity có thể settle cả payer AP và seller AR.

## Entry points
- Auth API:
  - `POST /invoice/invoices/:id/request-payment-confirmation`
  - `POST /invoice/invoices/:id/incoming-confirmation/accept`
  - `POST /invoice/invoices/:id/incoming-confirmation/reject`
- Public API:
  - `GET /public/invoice/payment-confirmations/:token`
  - `POST /public/invoice/payment-confirmations/:token/confirm`
  - `POST /public/invoice/payment-confirmations/:token/reject`
- Frontend:
  - `PaidConfirmDialog`
  - `IncomingPaymentDialog`
  - public route `/confirm-payment/:token`

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.controller.ts`
  - `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.public.controller.ts`
  - `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.service.ts`
- Frontend:
  - `apps/frontend/src/modules/invoice/features/invoices/components/PaidConfirmDialog.tsx`
  - `apps/frontend/src/modules/invoice/features/invoices/components/IncomingPaymentDialog.tsx`
  - `apps/frontend/src/core/public/pages/PaymentConfirmationPublicPage.tsx`
  - `apps/frontend/src/core/public/api/payment-confirmation-public.api.ts`
- Shared contracts:
  - `packages/shared-types/src/invoice.ts`

## Dependencies
- DB: `invoice.payment_confirmations`, `invoice.invoices`, `invoice.installments`, `core.tenant`.
- Services: `MailerService`, `InvoicesService`, `CompanyEmailsService`, `ConfigService`.
- Infra: public routes with ThrottlerGuard, SHA-256 token hashing, random 32-byte token.

## Inputs
- Auth request: recipient email and optional installmentId.
- Public token: 64 hex chars.
- In-app incoming actions: receivable invoice id.

## Outputs
- `RequestPaymentConfirmationResponse`
- `PaymentConfirmationPreviewDto`
- `ConfirmPaymentResponse`
- `RejectPaymentResponse`
- `InvoiceDetailDto` for incoming accept/reject.

## Side effects
- Creates pending confirmation row with token hash and expiry.
- Sends email with public link.
- Deletes older pending confirmation for same invoice/installment after successful send.
- Records recipient email on partner company.
- Confirming whole invoice marks payer AP invoice settled.
- Confirming installment marks only that installment paid and recomputes invoice rollup.
- In-app accept settles both payer AP and receiver AR in one transaction.
- Reject leaves invoice unsettled and marks confirmation rejected.

## Failure behavior
- Request is AP-only and rejects already-settled invoice.
- Installment request rejects missing/paid installment.
- Mailer failure deletes the just-created pending row.
- Malformed token returns 404 without DB lookup.
- Expired token returns 410 on confirm/reject.
- Confirming rejected token or rejecting confirmed token returns 409.
- Public routes are rate-limited.

## Retry behavior
- Sending a new request supersedes older pending request for same target.
- Confirm is idempotent if already CONFIRMED.
- Reject is idempotent if already REJECTED.
- Concurrent confirm/reject is guarded by `updateMany where status=PENDING`.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: AP-only request, token lifecycle, whole invoice vs installment scope, incoming claim matching by invoice identity, idempotent confirm/reject.
- `DATA_DEPENDENT`: payment_confirmations table, tokenHash unique, installment optional FK.
- `INFRA_DEPENDENT`: mailer, public URL config, throttling, crypto/token generation.
- `UI_DEPENDENT`: PaidConfirmDialog, IncomingPaymentDialog, public confirmation page.

## Capability trace

### CAP-005 - payment-confirmation

#### FLOW-001 - Request confirmation
- Trigger: user clicks "Paid?" on AP invoice or AP installment.
- Entry point: `PaidConfirmDialog` -> `useRequestPaymentConfirmation`.
- Calls: `POST /invoice/invoices/:id/request-payment-confirmation` -> load invoice by id+tenant -> validate AP/unsettled -> optional installment lookup/count -> generate token -> create confirmation -> send email -> delete older pending -> record email.
- Execution: email names payer, payee, amount, invoice label, and installment phase if scoped.
- Retry: user can resend; previous pending link for same invoice/installment is deleted after new email succeeds.
- Idempotency: not idempotent before send; after success latest pending row wins.
- Error handling: mailer error deletes created row and returns 400.
- Other: raw token only appears in email; DB stores SHA-256 hash.

#### FLOW-002 - Public preview
- Trigger: recipient opens link.
- Entry point: `/confirm-payment/:token` -> `paymentConfirmationPublicApi.preview`.
- Calls: `GET /public/invoice/payment-confirmations/:token` -> validate token shape -> hash -> `paymentConfirmation.findUnique` -> tenant logo lookup -> DTO.
- Execution: returns state, payer/payee names, invoice identity, amount, currency, optional installment context.
- Retry: public query retry is false; user can reload.
- Idempotency: read-only.
- Error handling: invalid/missing token returns 404; rate limit returns 429 in frontend notice.
- Other: no tenant-only data beyond safe preview.

#### FLOW-003 - Public confirm/reject
- Trigger: recipient clicks confirm or reject.
- Entry point: public page buttons.
- Calls confirm: `POST /confirm` -> `findByToken` -> state checks -> transaction -> `paymentConfirmation.updateMany(status=PENDING)` -> settle whole AP invoice or `InvoicesService.applyInstallmentConfirmed`.
- Calls reject: `POST /reject` -> `findByToken` -> state checks -> `updateMany(status=PENDING)` with rejectedAt.
- Execution: confirm settles payer side; reject leaves unpaid.
- Retry: confirm already CONFIRMED returns success; reject already REJECTED returns success.
- Idempotency: guarded by status transition from PENDING.
- Error handling: expired link 410; opposite terminal state 409; concurrent flip re-checks current state.
- Other: no login required.

#### FLOW-004 - Incoming AR claim accept/reject
- Trigger: AR list shows incoming payment claim; tenant accepts/rejects.
- Entry point: `IncomingPaymentDialog`.
- Calls: `findIncoming` -> load receivable by tenant -> reject non-AR -> find pending whole-invoice confirmation whose payer-side invoice matches sellerTaxCode, buyerTaxCode, symbol, number, date.
- Accept calls: transaction -> settle payer AP confirmation/invoice -> `InvoicesService.applyReceivableSettlement` for receiver AR.
- Reject calls: update confirmation to REJECTED.
- Execution: accepting settles both sides atomically.
- Retry: user can retry if conflict was transient.
- Idempotency: updateMany status=PENDING prevents double application.
- Error handling: no pending claim returns 409.
- Other: installment-scoped claims do not appear as incoming whole-invoice AR claims.

## Legacy/dead logic check
- Payment confirmation email HTML is hand-built in service, not shared email-template module. Treat this as current infra choice; repo mới can refactor mail rendering but must preserve behavior.
- `APP_PUBLIC_URL` default localhost is dev-friendly infra; production config must be reviewed during migration.

## Evidence
- `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.service.spec.ts`
- `apps/backend/src/infra/throttler/throttle-policy.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `packages/shared-types/src/invoice.ts`
