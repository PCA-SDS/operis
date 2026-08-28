# Old To New Invoice Data Mapping

This file maps old Invoice data semantics to the target Operis schema. It is
not a production data migration plan. The locked decision is code-only
migration for now.

Source evidence:

- `docs/invoice/DATA-OWNERSHIP-MAP.md`
- `docs/invoice/FEAT-001-invoices.md`
- `docs/invoice/FEAT-002-sync.md`
- `docs/invoice/PARITY-MATRIX.md`

## Ownership Classes

| Class | Meaning |
| --- | --- |
| `SOURCE_OWNED` | Comes from GDT/tax portal or company registry. Tenant should not directly edit it on imported rows. |
| `TENANT_OWNED` | User/business policy can edit it through UI/API. |
| `DERIVED` | Computed from other fields and stored for fast reads. Client cannot write it directly. |
| `OPERATIONAL` | Job state, token hash, retry state, telemetry, or internal workflow metadata. |

## Target Tables

| Target table | Purpose | Owner |
| --- | --- | --- |
| `invoice_companies` | Invoice partner master and payment terms. | Mixed |
| `invoice_company_emails` | Saved recipient emails per partner. | `TENANT_OWNED` |
| `invoice_auto_paid_tax_codes` | AP auto-paid rules. | `TENANT_OWNED` |
| `invoice_invoices` | Core AP/AR invoice header. | Mixed |
| `invoice_invoice_line_items` | Invoice lines. | Mixed |
| `invoice_installments` | AR installment plan. | Mixed |
| `invoice_payment_confirmations` | Confirmation workflow and token hash. | `OPERATIONAL` |
| `invoice_sync_jobs` | GDT sync job state. | `OPERATIONAL` |
| `invoice_company_registry` | Lookup provider cache. | `SOURCE_OWNED` / shared reference |

All tables store `tenant_id` and `organization_id`. User-editable entities store
`updated_at` for optimistic locking.

## Common Field Mapping

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `tenantId` | `tenant_id` | preserve from auth scope | `OPERATIONAL` | Never trust request body. |
| old tenant company scope | `organization_id` | adapt | `OPERATIONAL` | Use Operis organization scope from session. |
| `id` | `id` | new UUID | `OPERATIONAL` | No old data import in this plan. |
| `createdAt` | `created_at` | preserve behavior | `OPERATIONAL` | Created by ORM/app. |
| `updatedAt` | `updated_at` | preserve behavior | `OPERATIONAL` | Required for editable entities. |
| soft delete marker | `deleted_at` | adapt | `OPERATIONAL` | Use where entity supports delete/archive. |

## Persisted Enums And Value Contracts

Preserve these old values in the new module unless a later product decision and
migration changes them.

| Contract | Values |
| --- | --- |
| `direction` | `AR`, `AP` |
| `invoice_status` | `ACTIVE`, `CANCELLED`, `REPLACEMENT`, `ADJUSTMENT`, `REPLACED`, `ADJUSTED` |
| `origin` | `GOVERNMENT_PORTAL`, `MANUAL` |
| `settlement_status` | `UNSETTLED`, `PARTIALLY_PAID`, `SETTLED` |
| `installment.status` | `PENDING`, `PAID` |
| `payment_confirmation.status` | `PENDING`, `CONFIRMED`, `REJECTED` |
| `sync_job.state` | `QUEUED`, `AUTHENTICATING`, `FETCHING`, `PERSISTING`, `DONE`, `FAILED` |
| `sync_job.failure_category` | `AUTH_FAILED`, `ACCOUNT_LOCKED`, `PORTAL_UNREACHABLE`, `INTERNAL_ERROR` |
| list settlement filter | `settled`, `unsettled` |
| recoverability filter | `all`, `recoverable`, `nonRecoverable` |
| invoice currencies | `USD`, `EUR`, `GBP`, `SGD`, `AUD`, `JPY`, `CNY`, `KRW`, `THB`, `VND` |

Derived public states:

- Public payment confirmation preview can return `EXPIRED`, but this is derived
  from `status = PENDING` plus `expires_at < now`; do not persist `EXPIRED`.
- `settled` on DTOs is derived from `settlement_status = SETTLED`.

Important limits and defaults:

| Contract | Value |
| --- | --- |
| invoice page size | default 20, max 100 |
| partner list page size | default 20 |
| manual invoice line items | max 100 |
| manual issue date minimum | `2000-01-01` |
| max due days | 3650 |
| manual form default due days | 45 days when no matched partner terms are applied by the UI |
| new partner default due days | 30 days, unless explicitly cleared to null |
| payment confirmation token | 32 random bytes as 64 lowercase hex chars |
| payment confirmation TTL | 14 days |
| installment count | 2 to 60 |
| installment interest rate | 0 to 100 percent |
| non-recoverable note | max 1000 chars |

## `invoice_companies`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `company.id` | `invoice_companies.id` | new UUID | `OPERATIONAL` | Code-only migration. |
| `company.tenantId` | `tenant_id` | auth scope | `OPERATIONAL` | Required filter. |
| missing in old repo | `organization_id` | add | `OPERATIONAL` | Required filter. |
| `taxCode` / registration number | `tax_code` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | GDT can create/update source partner identity. Manual partner can create non-VN identity. |
| `country` | `country_code` | rename | `SOURCE_OWNED` or `TENANT_OWNED` | Use ISO-like code stored by old behavior. |
| `name` | `name` | preserve | Mixed | Sync updates only if source invoice date is newer than `name_source_date`. |
| `defaultDueDays` | `default_due_days` | preserve | `TENANT_OWNED` | CAP-003 can update only this policy field. |
| `nameSourceDate` | `name_source_date` | preserve | `OPERATIONAL` | Protects newest source name. |
| `searchText` | query index/search config | adapt | `DERIVED` | Do not accept as input. Prefer Operis search indexing over DB trigger unless implementation needs SQL index. |

Matching rules:

- Tax code match wins.
- If a tax code is present but does not match, do not fall back to name.
- Name-only match is case-insensitive.
- Lookup cache rows do not become partner rows until invoice save/import.
- New partner rows default `default_due_days` to 30. Settings may set it to
  `null`; when null, server fallback does not invent a due date.

## `invoice_invoices`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `invoice.id` | `invoice_invoices.id` | new UUID | `OPERATIONAL` | No old import. |
| `sourceInvoiceId` | `source_invoice_id` | preserve | `SOURCE_OWNED` / `OPERATIONAL` | GDT natural key or generated manual key. Unique per scope. |
| `origin` | `origin` | preserve | Mixed | Values include `MANUAL`, `GOVERNMENT_PORTAL`. |
| `direction` | `direction` | preserve | Mixed | `AR` means tenant is seller. `AP` means tenant is buyer. |
| partner relation | `company_id` | scalar FK id | Mixed | Relation inside invoice module only. No cross-module ORM relation. |
| seller tax snapshot | `seller_tax_code` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | GDT may overwrite on portal rows. |
| seller name snapshot | `seller_name` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | Snapshot, not live partner name. |
| buyer tax snapshot | `buyer_tax_code` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | Snapshot. |
| buyer name snapshot | `buyer_name` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | Snapshot. |
| `invoiceSymbol` | `invoice_symbol` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | Duplicate guard input. |
| `invoiceNumber` | `invoice_number` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | Duplicate guard input. |
| `invoiceCode` | `invoice_code` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | GDT code when available. |
| `invoiceDate` | `invoice_date` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | Used in forecast and name freshness. |
| `dueDate` | `due_date` | preserve | `TENANT_OWNED` | Sync sets initial default but must not overwrite tenant edits. |
| `currency` | `currency_code` | rename | Mixed | VND returns rate 1. |
| `status` | `invoice_status` | preserve | Mixed | Keep old enum values unless product removes them. |
| net amount | `net_amount` | adapt | `SOURCE_OWNED` or `DERIVED` | Manual rows compute server-side. |
| VAT amount | `vat_amount` | adapt | `SOURCE_OWNED` or `DERIVED` | Manual rows compute server-side. |
| `totalWithVat` | `gross_amount` | rename | `SOURCE_OWNED` or `DERIVED` | Main invoice total. |
| `hasReceived` | `has_received` | preserve | `DERIVED` | AR rollup only. |
| `hasPaid` | `has_paid` | preserve | `DERIVED` | AP rollup only. |
| `settlementStatus` | `settlement_status` | preserve | `DERIVED` | Do not accept in generic update. |
| `paidAmount` | `paid_amount` | preserve | `DERIVED` | Updated by settlement flows. |
| `outstandingAmount` | `outstanding_amount` | preserve | `DERIVED` | Sync must not overwrite settled value. |
| `nextDueDate` | `next_due_date` | preserve | `DERIVED` | Comes from due date or installments. |
| `hasInstallmentPlan` | `has_installment_plan` | preserve | `DERIVED` | Comes from installment rows. |
| `nonRecoverable` | `non_recoverable` | preserve | `TENANT_OWNED` | AR only. |
| `nonRecoverableNote` | `non_recoverable_note` | preserve | `TENANT_OWNED` | Required when setting true. |
| `nonRecoverableAt` | `non_recoverable_at` | preserve | `OPERATIONAL` | Set by command. |
| `lastSentAt` | `last_sent_at` | preserve | `OPERATIONAL` | AR send flow. |
| `emailTrackingToken` | `email_tracking_token_hash` | adapt | `OPERATIONAL` | Old system stored raw token. New target stores SHA-256 hex hash and hashes the path token before lookup. |
| `openedAt` | `opened_at` | preserve | `OPERATIONAL` | First open only. |
| `autoSettled` | `auto_settled` | preserve | `DERIVED` | Set by auto-paid. |
| `autoPayExcluded` | `auto_pay_excluded` | preserve | `TENANT_OWNED` / `OPERATIONAL` | Reverse auto-paid sets it. |

Manual invoice constraints:

- Manual create is AP only.
- Manual create rejects Vietnamese partners.
- Manual totals are recomputed from lines.
- Manual duplicate guard uses seller identity plus symbol/number.
- Explicit `dueDate` wins. If it is absent, use matched partner
  `default_due_days`. If that is null, persist no due date.
- If a tax code is absent, create or match the partner by case-insensitive name
  and use a synthetic internal identifier like `auto:<uuid>`.

Portal invoice constraints:

- `origin = GOVERNMENT_PORTAL` rows cannot be edited/deleted like manual rows.
- Tenant-owned payment metadata can still change through dedicated endpoints.
- New portal rows use partner `default_due_days` for initial due date. Re-sync
  does not overwrite tenant due-date edits.

## `invoice_invoice_line_items`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `line.id` | `id` | new UUID | `OPERATIONAL` | Recreated on manual update. |
| `invoiceId` | `invoice_id` | preserve relation | `OPERATIONAL` | Module-local relation. |
| `lineNumber` | `line_number` | preserve | Mixed | Sort key. |
| item name | `name` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | |
| item unit | `unit` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | |
| quantity | `quantity` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | Manual validate server-side. |
| unit price | `unit_price` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | |
| `discountAmount` | `discount_amount` | preserve | `TENANT_OWNED` / `DERIVED` | Manual rows resolve absolute discount server-side. |
| `discountPercent` | `discount_percent` | preserve | `TENANT_OWNED` | Stored for edit round-trip when user entered a percent discount. |
| VAT rate | `vat_rate` | preserve | `SOURCE_OWNED` or `TENANT_OWNED` | |
| `vatAmount` | `vat_amount` | preserve | `SOURCE_OWNED` or `DERIVED` | Manual rows compute server-side. |
| `lineTotal` | `line_total` | preserve | `SOURCE_OWNED` or `DERIVED` | Manual rows compute server-side. |

GDT sync may replace line items only when portal data includes line data. If the
source row has no line data, preserve existing lines.

## `invoice_installments`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `installment.id` | `id` | new UUID | `OPERATIONAL` | No old import. |
| `invoiceId` | `invoice_id` | preserve relation | `OPERATIONAL` | AR only. |
| `seq` | `sequence` | rename | `TENANT_OWNED` | Ordered plan. |
| `principal` | `principal_amount` | rename | `TENANT_OWNED` | Sum must equal invoice total. |
| `rate` | `interest_rate` | rename | `TENANT_OWNED` | Used to derive interest. |
| `interestAmount` | `interest_amount` | preserve | `DERIVED` | Computed. |
| `amount` | `total_amount` | rename | `DERIVED` | Principal plus interest. |
| `dueDate` | `due_date` | preserve | `TENANT_OWNED` | |
| `status` | `status` | preserve | Mixed | Confirmation can mark paid. |
| `paidAt` | `paid_at` | preserve | `OPERATIONAL` | |
| `note` | `note` | preserve | `TENANT_OWNED` | |

Rules:

- AR only.
- Saving a plan replaces all rows.
- Delete plan recomputes invoice rollup.
- Confirmation may settle one installment.

## `invoice_payment_confirmations`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `id` | `id` | new UUID | `OPERATIONAL` | |
| `invoiceId` | `invoice_id` | preserve relation | `OPERATIONAL` | AP request target. |
| `installmentId` | `installment_id` | preserve relation | `OPERATIONAL` | Optional. |
| `recipientEmail` | `recipient_email` | preserve | `OPERATIONAL` | Also recorded in company email memory best-effort. |
| raw token | not stored | remove | `OPERATIONAL` | Store only hash. |
| `tokenHash` | `token_hash` | preserve | `OPERATIONAL` | Public route lookup. |
| `status` | `status` | preserve | `OPERATIONAL` | Persist only pending, confirmed, rejected. Expired is derived. |
| `expiresAt` | `expires_at` | preserve | `OPERATIONAL` | |
| `confirmedAt` | `confirmed_at` | preserve | `OPERATIONAL` | |
| `rejectedAt` | `rejected_at` | preserve | `OPERATIONAL` | |

Rules:

- Request is AP only.
- New request supersedes older pending request for same invoice/installment.
- Mail failure rolls back the created confirmation.
- Public confirm is idempotent after confirmed.
- Expired or rejected tokens cannot be confirmed.
- Public preview derives state from `status` plus `expires_at`.
- Incoming AR confirmation matches pending AP confirmation by seller tax code,
  buyer tax code, invoice symbol, invoice number, and invoice date.

## `invoice_sync_jobs`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `id` | `id` | new UUID | `OPERATIONAL` | |
| `fromDate` | `from_date` | preserve | `TENANT_OWNED` | Request intent. |
| `toDate` | `to_date` | preserve | `TENANT_OWNED` | Request intent. |
| `scopeTaxCodes` | `scope_tax_codes` | preserve as JSONB/text array | `TENANT_OWNED` | Normalized and deduped. |
| `idempotencyKey` | `idempotency_key` | preserve | `TENANT_OWNED` | Unique per scope. |
| `startedByTenantUserId` | `started_by_user_id` | adapt | `OPERATIONAL` | User id from auth. |
| `state` | `state` | preserve | `OPERATIONAL` | pending/auth/fetching/done/failed style states. |
| progress counts | count columns | preserve | `OPERATIONAL` | Also mirrored to `ProgressJob`. |
| failure fields | error columns | preserve | `OPERATIONAL` | Use safe codes. |
| creation timestamp | `created_at` | standardize | `OPERATIONAL` | Set when the job row is created. |
| `startedAt` | `started_at` | preserve as nullable | `OPERATIONAL` | Set when the worker picks the job. |
| `finishedAt` | `finished_at` | preserve | `OPERATIONAL` | Set when the worker finishes or fails. |

Not stored:

- GDT password.
- Raw captcha solution.
- Raw GDT token.
- Captcha transaction secret.

These live only in Redis/cache with TTL.

Sync limits and cache TTLs:

| Item | Value |
| --- | --- |
| max window | 1825 inclusive days |
| normal cooldown | 300 seconds |
| failed-auth backoff | 900 seconds |
| max auth attempts | 3 |
| active lock TTL | 1800 seconds |
| captcha transaction TTL | 180 seconds |
| GDT token TTL cap | 82800 seconds |

## `invoice_company_emails`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `companyId` | `company_id` | preserve relation | `TENANT_OWNED` | Module-local relation. |
| `email` | `email` | preserve normalized | `TENANT_OWNED` | Unique per company/scope. |
| timestamps | timestamps | preserve | `OPERATIONAL` | |

Rules:

- Sending invoice records recipient best-effort.
- Payment confirmation request records recipient best-effort.
- Duplicate email does not create duplicate row.

## `invoice_auto_paid_tax_codes`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| `taxCode` | `tax_code` | preserve normalized | `TENANT_OWNED` | Unique per scope. |
| timestamps | timestamps | preserve | `OPERATIONAL` | |

Rules:

- Add rule upserts tax code and bulk-settles matching AP invoices.
- Remove rule reverts invoices that were auto-settled by that rule.
- Reverse auto-paid sets `auto_pay_excluded = true`.

## `invoice_company_registry`

| Old field | New field | Strategy | Owner | Notes |
| --- | --- | --- | --- | --- |
| country | `country_code` | preserve | `SOURCE_OWNED` | |
| identifier | `identifier` | preserve | `SOURCE_OWNED` | Tax code or jurisdiction id. |
| provider | `provider` | preserve | `SOURCE_OWNED` | |
| payload | `payload` | preserve JSONB | `SOURCE_OWNED` | Provider response cache. |
| fetchedAt | `fetched_at` | preserve | `OPERATIONAL` | Cache freshness. |

Rule:

- Company lookup does not create `invoice_companies` by itself.
- Cache TTL is 30 days.
- Lookup supports Vietnam MST and Singapore UEN. Other countries use manual
  entry only.

## GDT Sync Overwrite Rules

GDT sync may update these fields on `GOVERNMENT_PORTAL` invoices:

- source invoice identity
- origin and direction
- seller/buyer tax code snapshots
- seller/buyer name snapshots
- invoice symbol, number, code, date
- financial totals, currency, source status
- line items when source line data exists
- partner name only when source invoice date is newer than `name_source_date`

GDT sync must not overwrite:

- due date after tenant edit
- settlement status
- paid/received flags
- paid amount
- outstanding amount on settled invoice
- installments
- non-recoverable flags and notes
- auto-pay exclusion
- payment confirmation rows
- last sent/opened email state

If the implementation cannot tell whether due date was tenant-edited, add an
explicit metadata flag such as `due_date_source` with values `source_default`
and `tenant_override`.

## Resolved Source Decisions

These points were checked against the old repo and are resolved for Phase 3:

- Old email tracking stored a raw token in `email_tracking_token`. Target keeps
  behavior but stores `email_tracking_token_hash`; lookup hashes the raw path
  token before querying.
- Legacy enum values are listed in `Persisted Enums And Value Contracts`.
- Sync window, cooldown, lock, captcha, and token TTL defaults are listed in
  `invoice_sync_jobs`.
- Due-date fallback is explicit: request due date, then partner default due
  days, then null.
