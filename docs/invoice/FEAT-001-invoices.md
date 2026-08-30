# FEAT-001 - Invoices

## Description
Quản lý hóa đơn từ góc nhìn tenant/host company. `direction = AR` nghĩa là tenant là seller và đang được nợ tiền. `direction = AP` nghĩa là tenant là buyer và đang nợ nhà cung cấp.

## Purpose
Cho phép user xem, lọc, tạo hóa đơn thủ công, chỉnh metadata thanh toán, theo dõi paid/outstanding, forecast cash-flow, gửi invoice cho khách hàng, và xử lý installment/non-recoverable.

## User/business value
- Theo dõi AP/AR trong một nơi.
- Dashboard cho biết outstanding AP, outstanding AR, net position và cash-flow forecast.
- AR có thể đánh dấu received, lập installment plan, write-off non-recoverable.
- AP không tự mark paid trực tiếp, trừ auto-paid hoặc payment confirmation.

## Entry points
- API:
  - `GET /invoice/summary`
  - `GET /invoice/forecast`
  - `GET /invoice/invoices`
  - `GET /invoice/invoices/:id`
  - `POST /invoice/invoices`
  - `PUT /invoice/invoices/:id`
  - `DELETE /invoice/invoices/:id`
  - `PATCH /invoice/invoices/:id/due-date`
  - `PATCH /invoice/invoices/:id/settlement`
  - `PATCH /invoice/invoices/:id/reverse-auto-paid`
  - `PATCH /invoice/invoices/:id/non-recoverable`
  - `PUT /invoice/invoices/:id/installments`
  - `DELETE /invoice/invoices/:id/installments`
  - `PATCH /invoice/invoices/:id/installments/:installmentId`
  - `POST /invoice/invoices/:id/send`
- Frontend:
  - `/invoice`
  - `/invoice/all`
  - `/invoice/all/new`
  - `/invoice/all/:id`
  - `/invoice/all/:id/edit`
  - `/invoice/payables`
  - `/invoice/receivables`
- Public side-effect:
  - `GET /public/invoice/track/:token/pixel.gif`

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/invoices/invoices.controller.ts`
  - `apps/backend/src/modules/invoice/features/invoices/invoices.service.ts`
  - `apps/backend/src/modules/invoice/features/invoices/mappers.ts`
  - `apps/backend/src/modules/invoice/features/invoices/queries.ts`
  - `apps/backend/src/modules/invoice/features/invoices/dto/*`
  - `apps/backend/src/modules/invoice/features/email-tracking/*`
- Frontend:
  - `apps/frontend/src/modules/invoice/pages/InvoiceDashboardPage.tsx`
  - `apps/frontend/src/modules/invoice/features/invoices/pages/*`
  - `apps/frontend/src/modules/invoice/features/invoices/components/*`
  - `apps/frontend/src/modules/invoice/features/invoices/hooks/*`
  - `apps/frontend/src/modules/invoice/features/invoices/api/invoices.api.ts`
- Shared contracts:
  - `packages/shared-types/src/invoice.ts`
  - `packages/shared-types/src/invoice-email.ts`

## Dependencies
- DB: `invoice.invoices`, `invoice.invoice_line_items`, `invoice.installments`, `invoice.companies`, `invoice.payment_confirmations`.
- Services: `PrismaService`, `MailerService`, `CompanyEmailsService`, `AutoPaidService`, `ExchangeRatesService`, `ConfigService`.
- External APIs: mail provider via `MailerService`; exchange-rate feed when summaries/forecast need non-VND conversion.
- Auth/infrastructure: `JwtAuthGuard`, `TenantOnlyGuard`, `ModuleAccessGuard`, `@RequiresModule("invoice")`, TanStack Query.

## Inputs
- List filters: page, pageSize, search, direction, status, settlement, recoverability, partnerId, fromDate, toDate, sort, order.
- Create/update body: partner name/country/registration number, currency, invoice symbol/number/date/dueDate, totals, line items.
- Settlement inputs: boolean flags for settled/nonRecoverable/paid, due date, installment plan rows, recipient email.

## Outputs
- `InvoiceListResponse`
- `InvoiceDetailDto`
- `InvoiceSummaryDto`
- `InvoiceForecastDto`
- `SendInvoiceResponse`

## Side effects
- Create manual invoice creates or reuses `invoice.companies`.
- Create/update replaces line items and recomputes totals server-side.
- Update manual invoice clears settlement/installments/payment confirmations.
- Settlement/installment actions denormalize `settlementStatus`, `paidAmount`, `outstandingAmount`, `nextDueDate`, `hasPaid`, `hasReceived`.
- Sending invoice calls mailer, stamps `lastSentAt`, resets `openedAt`, stores `emailTrackingToken`, records recipient email.
- Tracking pixel stamps `openedAt` once, best effort.

## Failure behavior
- Tenant-owned reads/writes are scoped by `tenantId`; missing/foreign rows return 404.
- Portal/imported invoices (`origin = GOVERNMENT_PORTAL`) cannot be edited/deleted.
- Manual creation rejects Vietnamese partners; those must come from tax-portal sync.
- Duplicate seller + symbol + number is 409.
- AP cannot be settled by `PATCH /settlement`; AP payment uses auto-paid or payment confirmation.
- AR only: settlement, installments, non-recoverable.
- Non-recoverable requires reason and cannot apply to settled invoice.
- Missing FX rate for summaries/forecast returns 503 instead of unconverted totals.
- Mailer failure in `sendInvoice` returns 400 and does not stamp sent/opened or record recipient.
- Tracking pixel never throws to caller; it still returns GIF.

## Retry behavior
- Normal API writes have no automatic retry.
- Frontend mutations invalidate invoice list/detail/summary caches after success.
- Email tracking is best effort; failed DB write is logged and not retried.
- User can resend invoice email manually; each send creates a new tracking token and clears previous open state.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: direction semantics, manual invoice constraints, line total calculation, discount amount/percent rule, settlement rollup, forecast grouping, non-recoverable rule.
- `DATA_DEPENDENT`: invoice schema, denormalized payment columns, search_text triggers/indexes, sourceInvoiceId uniqueness, partner master.
- `INFRA_DEPENDENT`: Prisma transactions, mailer, ConfigService, public tracking endpoint, exchange rates dependency.
- `UI_DEPENDENT`: invoice dashboard, list filters, detail panels, create/edit form, dialogs.

## Capability trace

### CAP-001 - invoice-management

#### FLOW-001 - Dashboard summary and forecast
- Trigger: user opens `/invoice`.
- Entry point: `InvoiceDashboardPage` -> `useInvoiceSummary` / `useInvoiceForecast`.
- Calls: `invoicesApi.summary` -> `GET /invoice/summary` -> `InvoicesController.getSummary` -> `InvoicesService.getSummary` -> `prisma.invoice.groupBy` -> `buildVndRates` -> `ExchangeRatesService.getRates` when needed -> `summarizeDirection` -> `InvoiceSummaryDto`.
- Calls: `invoicesApi.forecast` -> `GET /invoice/forecast` -> `InvoicesService.getForecast` -> `prisma.invoice.findMany` -> `accumulateForecast` -> `toForecastSeries` / `toNetForecastSeries` -> `InvoiceForecastDto`.
- Execution: summary groups active invoices by direction, settlement, nonRecoverable, currency. Forecast expands pending installments or uses invoice due date; AR non-recoverable and settled invoices are excluded.
- Retry: frontend retry button refetches queries.
- Idempotency: read-only.
- Error handling: impossible throughDate rejected by shared date parser; missing FX returns 503.
- Other: totals are reported in VND; non-VND invoices are converted at current rate.

#### FLOW-002 - List and detail
- Trigger: user opens `/invoice/all`, `/invoice/payables`, `/invoice/receivables`, or invoice detail.
- Entry point: `InvoicesView`, `InvoiceDetailPage`.
- Calls: `useInvoices` -> `invoicesApi.list` -> `GET /invoice/invoices` -> `buildInvoiceWhere` / `buildInvoiceOrderBy` -> Prisma findMany/count -> `toInvoiceListItemDto`.
- Calls: list post-processing -> `markIncomingConfirmations` -> query pending whole-invoice confirmations by shared invoice identity -> set `hasIncomingConfirmation`.
- Calls: `useInvoice` -> `invoicesApi.detail` -> `GET /invoice/invoices/:id` -> `toInvoiceDetailDto`.
- Execution: filters use tenantId plus searchText, direction, status, settlement, recoverability, partner, invoice date range. Detail includes line items and installments ordered by line/seq.
- Retry: query retry according to TanStack settings and user retry action.
- Idempotency: read-only.
- Error handling: foreign/missing invoice returns 404.
- Other: recoverability filter applies mainly to AR; AP cannot be non-recoverable.

#### FLOW-003 - Manual create/update/delete
- Trigger: user opens `/invoice/all/new` or `/invoice/all/:id/edit`, submits form, or deletes manual invoice.
- Entry point: `InvoiceFormPage`, `useCreateInvoice`, `useUpdateInvoice`, `useDeleteInvoice`.
- Calls create: `buildPayload` -> `POST /invoice/invoices` -> `assertValidDates` -> `stampParties` -> `assertPartnerIdentity` -> `assertNoDuplicate` -> `normalizeLineItems` -> `upsertPartner` -> `resolveDueDate` -> `AutoPaidService.isAutoPaid` -> `prisma.invoice.create` -> DTO.
- Calls update: `PUT /invoice/invoices/:id` -> load existing -> reject non-MANUAL -> same validation/normalize/upsert -> `prisma.invoice.update` with lineItems delete/create, installments delete, paymentConfirmations delete -> DTO.
- Calls delete: `DELETE /invoice/invoices/:id` -> load existing -> reject non-MANUAL -> `prisma.invoice.delete`.
- Execution: created manual invoice is always AP, international-only, origin `MANUAL`. Host tenant is buyer; partner is seller. Totals are recomputed from line items, not trusted from client.
- Retry: no automatic write retry; user can submit again. Duplicate guard prevents same seller identity + symbol + number.
- Idempotency: no idempotency key. Duplicate invoice check is the protection.
- Error handling: invalid date/range, Vietnamese partner, duplicate invoice, imported invoice edit/delete all fail before write.
- Other: partner without registration number is matched by case-insensitive name; if no match, synthetic `auto:<uuid>` taxCode is created.

#### FLOW-004 - Due date update
- Trigger: user edits due date in list/detail.
- Entry point: `DueDateEditor`, `useSetDueDate`.
- Calls: `PATCH /invoice/invoices/:id/due-date` -> load invoice -> parse/validate due date -> `prisma.invoice.update`.
- Execution: due date can be set/cleared for any origin. If no installment plan and not settled, `nextDueDate` follows dueDate. If there is a plan, per-installment dates remain the payment schedule.
- Retry: user can retry manually.
- Idempotency: setting same date again is harmless.
- Error handling: due date before invoiceDate or beyond max terms returns 400.
- Other: due date is tenant-owned payment metadata, not immutable tax data.

#### FLOW-005 - AR settlement and non-recoverable
- Trigger: user marks AR received/not received or writes off AR.
- Entry point: `InvoicesView`, `InvoiceDetailPage`, `NonRecoverableDialog`.
- Calls settlement: `PATCH /invoice/invoices/:id/settlement` -> `setSettlement` -> reject AP -> transaction -> `applyReceivableSettlement` -> update invoice or all installments -> `recompute`.
- Calls write-off: `PATCH /invoice/invoices/:id/non-recoverable` -> reject AP -> require note when setting true -> update nonRecoverable fields -> detail.
- Execution: settling AR clears non-recoverable flag. With plan, settlement flips every installment. Without plan, invoice rollup is set directly.
- Retry: user can retry manually.
- Idempotency: setting same state repeatedly converges to same rollup.
- Error handling: AP forbidden; settled invoice cannot be marked non-recoverable.
- Other: non-recoverable remains visible for audit but is excluded from collectable AR summary/forecast.

#### FLOW-006 - Installment plan
- Trigger: user opens installment dialog and creates/replaces/deletes plan, or toggles a phase.
- Entry point: `InstallmentsDialog`, `useInstallmentActions`.
- Calls save: `PUT /invoice/invoices/:id/installments` -> load invoice -> reject AP -> `buildInstallments` -> transaction delete/create installments -> `recompute`.
- Calls delete: `DELETE /invoice/invoices/:id/installments` -> reject AP -> deleteMany installments -> `recompute`.
- Calls toggle: `PATCH /invoice/invoices/:id/installments/:installmentId` -> reject AP -> validate installment belongs to invoice/tenant -> updateMany -> `recompute`.
- Execution: principals must sum exactly to invoice `totalWithVat`. Interest is amortized per phase as rate x remaining balance before that phase. Settlement rollup comes from paid vs pending installments.
- Retry: user can retry manually.
- Idempotency: replacing plan is wholesale; repeated same body recreates equivalent plan with new installment ids.
- Error handling: AP forbidden; invalid principal sum/rate/date returns 400; foreign installment returns 404.
- Other: payment confirmation can target a single installment.

#### FLOW-007 - Send invoice and tracking pixel
- Trigger: user sends/resends AR invoice email.
- Entry point: `SendInvoicePanel`, `useSendInvoice`.
- Calls: `POST /invoice/invoices/:id/send` -> `getInvoice` -> reject AP -> `buildInvoiceEmailSubject` / `buildInvoiceEmailHtml` -> optional `buildTrackingPixel` -> `MailerService.send` -> stamp invoice -> `CompanyEmailsService.record`.
- Calls tracking: email client loads pixel -> `GET /public/invoice/track/:token/pixel.gif` -> `EmailTrackingService.recordOpen` -> `invoice.updateMany` where token and openedAt null -> return transparent GIF.
- Execution: AR only. Email HTML mirrors detail page formatting from shared-types. Pixel URL is emitted only when `EMAIL_ASSET_BASE_URL` is http(s).
- Retry: user can resend. Tracking has no retry.
- Idempotency: each send generates a new token and clears `openedAt`; tracking only stamps if not already opened.
- Error handling: mailer failure returns 400; stamp/recipient record failure is logged but send still succeeds. Pixel DB failure is swallowed.
- Other: open tracking is best effort because clients can block/proxy images.

## Legacy/dead logic check
- `InvoiceStatus` includes replacement/adjustment statuses, but current flow mostly creates/imports `ACTIVE`; do not remove without checking portal import/status roadmap.
- `hasPaid` / `hasReceived` mirror `settlementStatus` but still drive UI/business labels; keep or replace with a planned compatibility migration.
- Some UI buttons in invoice surfaces are raw buttons, but this dossier is read-only and does not change UI primitives.

## Evidence
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`
- `apps/backend/src/modules/invoice/features/email-tracking/email-tracking.service.spec.ts`
- `apps/frontend/src/modules/invoice/features/invoices/components/dashboard/forecast-chart.test.ts`
- `apps/backend/prisma/schema.prisma`
- `packages/shared-types/src/invoice.ts`
- `packages/shared-types/src/invoice-email.ts`
- `packages/module-registry/src/index.ts`
