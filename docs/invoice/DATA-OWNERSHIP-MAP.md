# Invoice Data Ownership Map

Tài liệu này mô tả semantic ownership của dữ liệu Invoice: field/table nào do nguồn ngoài sở hữu, tenant sở hữu, hệ thống tự sinh, hoặc derived/denormalized. Mục tiêu là khi migrate không đoán sai ai được mutate field nào.

## Ownership Types

| Type | Meaning |
| --- | --- |
| `SOURCE_OWNED` | Dữ liệu đến từ nguồn ngoài như GDT/tax portal hoặc company registry provider. App không nên cho tenant sửa trực tiếp trên portal-origin rows. |
| `TENANT_OWNED` | Tenant nhập/sửa qua UI/API. |
| `SYSTEM_OWNED` | App sinh ra để vận hành flow: token hash, sync job state, timestamps, tracking token. |
| `DERIVED_DENORMALIZED` | Tính từ dữ liệu khác và lưu lại để query/UI nhanh hơn. Không nhận trực tiếp từ client. |
| `SHARED_REFERENCE` | Reference/cache dùng chung, không phải business record của riêng invoice feature. |

## Table Ownership

| Table | Semantic Owner | Mutators | Notes |
| --- | --- | --- | --- |
| `invoice.company_registry` | `SHARED_REFERENCE` | `CompanyLookupService` and providers | Cache dữ liệu public lookup. Invoice route chỉ gọi lookup/autofill, không biến row này thành partner. |
| `invoice.companies` | Mixed: partner identity from source/manual, payment terms tenant-owned | `SyncPersistenceService`, `InvoicesService.create/update`, `PartnersService.updatePaymentTerms` | Partner master dùng chung cho invoice. `defaultDueDays` là tenant-owned; `nameSourceDate` bảo vệ latest-name-by-invoice-date từ sync. |
| `invoice.company_emails` | `TENANT_OWNED` recipient memory | `CompanyEmailsService.record/remove` | Producer gián tiếp: send invoice và payment confirmation request. |
| `invoice.auto_paid_tax_codes` | `TENANT_OWNED` rule table | `AutoPaidService.add/remove` | Rule theo tenant + taxCode; effect lên AP invoices là system-applied domain behavior. |
| `invoice.invoices` | Mixed | `InvoicesService`, `SyncPersistenceService`, `AutoPaidService`, `PaymentConfirmationsService`, `EmailTrackingService` | Core table. Portal rows có source-owned fields; manual rows có tenant-owned source fields. Payment rollups là derived/system-mutated. |
| `invoice.invoice_line_items` | Mixed | `InvoicesService`, `SyncPersistenceService` | Portal line items source-owned; manual line items tenant-owned but totals are server-recomputed. |
| `invoice.installments` | `TENANT_OWNED` plan with derived rollup effect | `InvoicesService`, indirectly `PaymentConfirmationsService` through `InvoicesService` | AR-only. Confirmation can mark one installment paid. |
| `invoice.payment_confirmations` | `SYSTEM_OWNED` workflow state | `PaymentConfirmationsService` | Raw token is never stored; only hash. Public link mutates status. |
| `invoice.sync_jobs` | `SYSTEM_OWNED` job state | `SyncService`, `SyncProcessor` | Represents sync execution. GDT password/token/captcha are intentionally outside DB. |

## Field Ownership By Table

### `invoice.companies`

| Field group | Owner | Mutated By | Notes |
| --- | --- | --- | --- |
| `tenantId` | `SYSTEM_OWNED` | create paths only | Comes from authenticated tenant context, not request body. |
| `taxCode`, `country` | `SOURCE_OWNED` or `TENANT_OWNED` at creation | sync/manual create | Unique per tenant. Existing manual upsert does not freely rewrite partner identity. |
| `name` | Mixed | sync/manual create | Sync updates name only when invoice date is newer than `nameSourceDate`. |
| `defaultDueDays` | `TENANT_OWNED` | `PartnersService.updatePaymentTerms` | Source of default due date for new/imported invoices. |
| `nameSourceDate` | `SYSTEM_OWNED` source freshness marker | `SyncPersistenceService` | Null for manual partners unless sync later owns freshness. |
| `searchText` | `DERIVED_DENORMALIZED` | DB trigger only | App must not write it. |
| timestamps | `SYSTEM_OWNED` | Prisma/DB | Audit metadata. |

### `invoice.invoices`

| Field group | Owner | Mutated By | Notes |
| --- | --- | --- | --- |
| `tenantId` | `SYSTEM_OWNED` | create/import only | Always scoped from auth/session. |
| `sourceInvoiceId` | `SOURCE_OWNED` for portal, `SYSTEM_OWNED` for manual | `SyncPersistenceService`, `InvoicesService.create` | Unique per tenant. Portal natural key uses GDT identifiers; manual uses generated id. |
| `origin`, `direction` | Source/manual create owner | create/import only | Portal direction from sold/purchased stream; manual create is AP-only. |
| seller/buyer tax/name snapshots | Source/manual create owner | sync/manual create/update | Portal rows should not be tenant-edited; manual rows are editable. Snapshots do not auto-follow partner rename. |
| invoice symbol/number/code/date | Source/manual create owner | sync/manual create/update | Portal-origin update/delete is blocked in service. |
| totals/currency/status | Source/manual create owner | sync/manual create/update | Manual totals are recomputed server-side from line items. |
| `dueDate` | `TENANT_OWNED` plus defaulting | `InvoicesService.setDueDate`, create/update, `SyncPersistenceService` initial value | Defaults from partner terms; tenant can override after import. |
| `hasReceived`, `hasPaid` | `DERIVED_DENORMALIZED` payment state | `InvoicesService`, `AutoPaidService`, `PaymentConfirmationsService` | Do not accept directly from generic update. |
| `settlementStatus`, `paidAmount`, `outstandingAmount`, `nextDueDate`, `hasInstallmentPlan` | `DERIVED_DENORMALIZED` | `InvoicesService` and payment flows | Must stay consistent with invoice total/installments/payment actions. |
| `nonRecoverable`, `nonRecoverableNote`, `nonRecoverableAt` | `TENANT_OWNED` AR policy | `InvoicesService.markNonRecoverable/clearNonRecoverable` | AR-only; settled invoice cannot become non-recoverable. Excluded from collectable AR totals/forecast. |
| `lastSentAt`, `emailTrackingToken`, `openedAt` | `SYSTEM_OWNED` email telemetry | `InvoicesService.sendInvoice`, `EmailTrackingService.recordOpen` | Tracking is best-effort; pixel never fails user-facing. |
| `autoSettled`, `autoPayExcluded` | Mixed system + tenant action | `AutoPaidService`, `InvoicesService.reverseAutoPaid` | Reverse marks excluded so future auto-paid does not re-settle. |
| `searchText` | `DERIVED_DENORMALIZED` | DB trigger only | Search helper reads it; app must not write it. |

### `invoice.invoice_line_items`

| Field group | Owner | Mutated By | Notes |
| --- | --- | --- | --- |
| identity and `invoiceId` | `SYSTEM_OWNED` | invoice create/update/import | Child of invoice. |
| item fields | Source/manual owner | `SyncPersistenceService`, `InvoicesService` | Manual update replaces the set. |
| `vatAmount`, `lineTotal` | `DERIVED_DENORMALIZED` for manual | `InvoicesService` | Server recomputes; do not trust client totals. |

### `invoice.installments`

| Field group | Owner | Mutated By | Notes |
| --- | --- | --- | --- |
| plan rows: seq/principal/rate/dueDate/note | `TENANT_OWNED` | `InvoicesService.saveInstallments/deleteInstallments` | AR-only; principal sum must equal invoice total. |
| `interestAmount`, `amount` | `DERIVED_DENORMALIZED` | `InvoicesService` | Interest is calculated per remaining balance before phase. |
| `status`, `paidAt` | Mixed tenant/system | `InvoicesService.setInstallmentStatus`, `PaymentConfirmationsService` via invoice service | Confirmation can mark a phase paid. |

### `invoice.payment_confirmations`

| Field group | Owner | Mutated By | Notes |
| --- | --- | --- | --- |
| `invoiceId`, `installmentId`, `recipientEmail`, `expiresAt` | `SYSTEM_OWNED` from request workflow | `PaymentConfirmationsService.request` | Request validates AP-only and unsettled/unpaid target. |
| `tokenHash` | `SYSTEM_OWNED` | `PaymentConfirmationsService.request` | Raw token is not stored. |
| `status`, `confirmedAt`, `rejectedAt` | `SYSTEM_OWNED` public workflow state | public confirm/reject, incoming reject | Confirm is idempotent once confirmed; expired/rejected are blocked. |

### `invoice.sync_jobs`

| Field group | Owner | Mutated By | Notes |
| --- | --- | --- | --- |
| `fromDate`, `toDate`, `scopeTaxCodes`, `idempotencyKey`, `startedByTenantUserId` | `TENANT_OWNED` request intent + auth context | `SyncService.start` | Requires acknowledgements and VN MST tenant. |
| `state`, progress, counts, failure fields, timestamps | `SYSTEM_OWNED` execution state | `SyncService`, `SyncProcessor` | Used by polling UI and recovery/failure classification. |

## Source-Owned Fields

These should be preserved from source for `GOVERNMENT_PORTAL` invoices:

- Portal natural identity: seller MST, buyer MST, template/code/series/number.
- Seller/buyer names and tax codes.
- Invoice symbol, number, code, date.
- Financial totals, currency, status.
- Line item content when provided by source.

Tenant can still mutate payment-side metadata on imported invoices:

- `dueDate`.
- AR settlement/non-recoverable/installments.
- AP settlement through confirmation/auto-paid/reverse-auto-paid.

## Tenant-Owned Fields

Tenant-owned mutation surfaces:

- Partner `defaultDueDays`.
- Saved company recipient emails.
- Auto-paid tax-code rules.
- Manual AP invoice content and line items.
- Due dates.
- AR non-recoverable decision and note.
- AR installment plan and manual installment status.
- Receiver decision to accept/reject incoming payment confirmation.

## Derived Or Denormalized Fields

Do not accept these as direct client writes:

- `searchText` on searchable tables.
- `hasReceived`, `hasPaid`.
- `settlementStatus`.
- `paidAmount`, `outstandingAmount`.
- `nextDueDate`.
- `hasInstallmentPlan`.
- Manual line totals and VAT totals.
- Summary/forecast VND conversions.

## Intentionally Missing From Database

These missing fields are deliberate and should not be added during migration unless product/security direction changes:

- GDT password: never persisted.
- GDT access token/captcha transaction: Redis only.
- Raw payment-confirmation token: only hash at rest.
- Converted VND invoice totals: computed for summary/forecast, not stored on invoice rows.
- Company lookup result as partner row: lookup cache is separate; form/user action creates partner through invoice create/update.
- Tenant id in tenant-facing request bodies: always from JWT/session.

## Mutation Boundaries

| Surface | Allowed Mutations |
| --- | --- |
| `PATCH /invoice/invoices/:id` | Manual invoices only; source fields for portal invoices are protected. |
| `PATCH /invoice/invoices/:id/due-date` | Due date only, tenant-scoped. |
| `PATCH /invoice/invoices/:id/settlement` | AR settlement only; AP direct settlement blocked. |
| installment endpoints | AR installment plan/status only. |
| auto-paid endpoints | Rule table plus bulk AP settlement/revert. |
| payment confirmation public endpoints | Confirmation status plus invoice settlement effects. |
| sync worker | Portal source fields and source-owned line items; preserves tenant payment metadata. |
| email tracking pixel | `openedAt` only, by tracking token and only once. |

## Migration Warnings

- Do not merge `company_registry` and `companies`. They answer different questions.
- Do not make `defaultDueDays` source-owned; it is tenant policy.
- Do not allow generic invoice update to mutate settlement rollup fields directly.
- Do not remove `autoPayExcluded`; it is the replay guard after reverse auto-paid.
- Do not persist raw secrets/tokens to get easier debugging.
- Do not treat `searchText` as application input; it is DB-owned infrastructure.
