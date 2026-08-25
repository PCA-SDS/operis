# FEAT-002 - Tax Portal Sync

## Description
Đồng bộ hóa đơn điện tử từ Vietnam GDT portal. Stream `sold` tạo AR, stream `purchased` tạo AP. Token/captcha/password không lưu vào DB.

## Purpose
Import hóa đơn cũ và mới từ cổng thuế, dedupe bằng natural key, cập nhật partner master, giữ nguyên các field thanh toán do tenant sở hữu.

## User/business value
- Giảm nhập tay hóa đơn nội địa.
- Lấy cả issued invoices và received invoices.
- Có progress, counts, failure reason để user biết sync đang làm gì.

## Entry points
- API:
  - `GET /invoice/sync`
  - `GET /invoice/sync/:jobId`
  - `POST /invoice/sync`
  - `POST /invoice/sync/authenticate`
- Frontend:
  - `SyncButton`
  - `SyncDialog`
  - `useSyncAvailability`
  - `useSyncJob`
- Worker:
  - BullMQ queue `INVOICE_SYNC_QUEUE`
  - processor `SyncProcessor`

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/sync/sync.controller.ts`
  - `apps/backend/src/modules/invoice/features/sync/sync.service.ts`
  - `apps/backend/src/modules/invoice/features/sync/sync.processor.ts`
  - `apps/backend/src/modules/invoice/features/sync/sync-persistence.service.ts`
  - `apps/backend/src/modules/invoice/features/sync/sync-validation.ts`
  - `apps/backend/src/modules/invoice/features/sync/gdt/*`
  - `apps/backend/src/modules/invoice/features/sync/captcha-store.service.ts`
  - `apps/backend/src/modules/invoice/features/sync/gdt-token-cache.service.ts`
- Frontend:
  - `apps/frontend/src/modules/invoice/features/sync/api/sync.api.ts`
  - `apps/frontend/src/modules/invoice/features/sync/hooks/use-sync.ts`
  - `apps/frontend/src/modules/invoice/features/sync/components/SyncDialog.tsx`
- Shared contracts:
  - `packages/shared-types/src/invoice-sync.ts`

## Dependencies
- DB: `invoice.sync_jobs`, `invoice.invoices`, `invoice.companies`, `invoice.invoice_line_items`.
- Infra: BullMQ, Redis locks, Redis JSON cache, ConfigService, Prisma.
- External API: Vietnam GDT portal through `HttpGdtClient`.
- Related service: `AutoPaidService.applyAll` after sync.

## Inputs
- `StartSyncRequest`: idempotencyKey, fromDate, toDate, scopeTaxCodes, acknowledgements.
- `AuthenticateSyncRequest`: transactionId, password, captchaSolution.
- Tenant MST from authenticated session, never from body.

## Outputs
- `SyncAvailabilityDto`
- `StartSyncResponse`
- `AuthenticateSyncResponse`
- `SyncJobStatusDto`

## Side effects
- Creates `invoice.sync_jobs` row.
- Stores captcha transaction and GDT token in Redis.
- Adds BullMQ job.
- Upserts partner companies and invoices.
- Replaces line items only when portal row has line data.
- Marks matching AP invoices auto-paid after persistence pass.
- Updates sync progress/counts/failure state.

## Failure behavior
- Feature unusable when `GDT_BASE_URL` missing or tenant MST is not Vietnamese.
- Start rejects missing acknowledgements, invalid/future/range-too-large dates, invalid scope tax codes.
- Cooldown prevents too-frequent syncs.
- One active job per tenant; stale active jobs are marked failed.
- Auth has transaction attempts plus tenant failure backoff.
- Portal 401 mid-sync becomes `AUTH_FAILED`; 5xx/network becomes `PORTAL_UNREACHABLE`; unknown error becomes `INTERNAL_ERROR`.
- A bad single invoice row is skipped and counted, not fatal.

## Retry behavior
- GDT HTTP GET retries on network, 429, 5xx with backoff.
- BullMQ job attempts are set to 1; retry is manual by starting sync again.
- User can retry captcha/credentials until configured max attempts.
- Start with same `(tenantId, idempotencyKey)` returns existing job.
- Frontend polls job every 1.5s until DONE/FAILED and invalidates invoice caches at terminal state.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: sold->AR, purchased->AP, sourceInvoiceId natural key, latest company name by invoice date, scopeTaxCodes filter, tenant-owned payment fields preservation.
- `DATA_DEPENDENT`: sync_jobs table, invoice/partner upserts, line item schema, unique `(tenantId, sourceInvoiceId)`.
- `INFRA_DEPENDENT`: Redis token/captcha/locks/cooldowns, BullMQ, ConfigService, GDT HTTP client, retry/backoff.
- `UI_DEPENDENT`: dialog steps, polling, captcha SVG, acknowledgement copy.

## Capability trace

### CAP-002 - tax-portal-sync

#### FLOW-001 - Check availability/latest status
- Trigger: Sync button renders or dialog opens.
- Entry point: `useSyncAvailability` -> `syncApi.availability`.
- Calls: `GET /invoice/sync` -> `SyncController.availability` -> `SyncService.availability` -> latest `invoiceSyncJob` -> `HttpGdtClient.isConfigured` -> `isVietnameseMst` -> DTO.
- Execution: returns `canSync`, reason, tenant taxCode, portalUrl, latest job.
- Retry: query refetch interval 30s.
- Idempotency: read-only.
- Error handling: normal auth/module guards apply.
- Other: tenant tax code comes from JWT/session context.

#### FLOW-002 - Start with cached token
- Trigger: user chooses date/scope and accepts both acknowledgements.
- Entry point: `SyncDialog.startMutation` -> `syncApi.start`.
- Calls: `POST /invoice/sync` -> `assertFeatureUsable` -> `assertAcknowledged` -> `assertValidSyncWindow` -> `normalizeScopeTaxCodes` -> idempotency lookup -> cooldown check -> active job check -> `GdtTokenCacheService.get` -> `enqueue`.
- Calls enqueue: Redis lock -> create `sync_jobs` row -> `queue.add("sync", {jobId, tenantId, lockKey, lockToken})`.
- Execution: if token exists, no captcha step; job is queued directly.
- Retry: same idempotency key returns same job; lock prevents concurrent starts.
- Idempotency: DB unique `(tenantId, idempotencyKey)` plus BullMQ `jobId`.
- Error handling: queue failure marks job FAILED, releases lock, returns 503.
- Other: `removeOnComplete` and `removeOnFail` keep queue history bounded.

#### FLOW-003 - Start requiring captcha/auth
- Trigger: no cached token exists.
- Entry point: same as FLOW-002.
- Calls: `gdt.fetchCaptcha` -> `CaptchaStoreService.create` -> Redis JSON with tenant, captcha key, user id, request fields -> response `auth_required`.
- Execution: frontend renders captcha SVG and password field.
- Retry: user can go back and restart; captcha tx has TTL.
- Idempotency: no job created until auth succeeds.
- Error handling: expired transaction later returns 410 Gone.
- Other: password is not sent on start call.

#### FLOW-004 - Authenticate and enqueue
- Trigger: user submits portal password + captcha.
- Entry point: `syncApi.authenticate`.
- Calls: `POST /invoice/sync/authenticate` -> load captcha transaction -> tenant ownership check -> Redis auth-fails check -> bump attempt -> `gdt.authenticate` -> scrub password wrapper in finally.
- Success calls: `tokens.set` -> delete captcha tx -> clear auth failures -> active job check -> `enqueue`.
- Retry calls: `gdt.fetchCaptcha` -> `captchaStore.rotate` -> response `retry`.
- Execution: success queues the saved original sync request.
- Retry: captcha/credential retry until max attempts; tenant-level backoff after too many failures.
- Idempotency: saved idempotencyKey reused from captcha transaction.
- Error handling: account locked returns `account_locked`; too many attempts starts cooldown.
- Other: `startedByTenantUserId` can be null if user vanished.

#### FLOW-005 - Worker fetch/persist
- Trigger: BullMQ processes `sync` job.
- Entry point: `SyncProcessor.process`.
- Calls: find sync job -> mark AUTHENTICATING -> load tenant taxCode -> get cached token -> mark FETCHING -> for each stream sold/purchased -> `GdtFetcherService.fetch`.
- Calls fetcher: `iterateWindows` -> GDT `fetchPage` with date search/cursor/pageSize -> pacing sleep -> yield batches.
- Calls persist: `normalizeInvoice` -> `SyncPersistenceService.persist` -> preload partners/invoices -> `upsertPartner` -> `upsertInvoice`.
- Execution: created invoices are origin `GOVERNMENT_PORTAL`, ACTIVE, UNSETTLED, outstanding total, due date from partner default terms. Existing invoices update source snapshot and line items but keep settlement/due date/paid fields.
- Retry: no BullMQ retry; user can start sync again and dedupe handles repeats.
- Idempotency: `sourceInvoiceId = gdt:sellerMst:templateCode:series:number`, unique per tenant.
- Error handling: invalid invoice rows are skipped; worker-level error marks job FAILED and keeps partial counts.
- Other: final pass `AutoPaidService.applyAll` is best effort; failure logs warning but sync can finish DONE.

## Legacy/dead logic check
- `SyncJobState.AUTHENTICATING` is marked transient/forward-compatible; current auth mostly happens before enqueue, but worker still sets it.
- GDT naming and comments mix TCT/GDT terms; treat as historical naming, not business difference.
- No automatic worker retry; this is intentional in current code, but repo mới should decide if queue retry policy changes.

## Evidence
- `apps/backend/src/modules/invoice/features/sync/sync-validation.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/sync-persistence.service.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/gdt/invoice-normalizer.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/gdt/gdt-fetcher.service.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `packages/shared-types/src/invoice-sync.ts`
