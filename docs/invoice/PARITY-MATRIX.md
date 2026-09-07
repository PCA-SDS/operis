# Invoice Parity Matrix

Tài liệu này map từng CAP sang bằng chứng hiện có trong old repo và các scenario còn thiếu để migration không đoán business logic. Nó không document lại từng feature.

## Parity Summary

| CAP | Capability | Existing Evidence | Migration Blocker? |
| --- | --- | --- | --- |
| CAP-001 | Invoice management | Strong backend unit coverage; limited frontend coverage | No blocker, but needs E2E/UI parity scenarios |
| CAP-002 | Tax portal sync | Good validation/persistence/normalizer coverage; weak orchestration coverage | Infra parity blocker until Redis/BullMQ/GDT start-auth scenarios are proven |
| CAP-003 | Partner payment terms | Focused backend service coverage | No blocker |
| CAP-004 | Auto-paid | Indirect coverage through invoice create/reverse; weak direct service coverage | Needs DB/integration scenario for bulk SQL parity |
| CAP-005 | Payment confirmations | Strong backend service coverage | No blocker, but public-route throttle/email scenario should be checked |
| CAP-006 | Company email memory | Indirect coverage through send/request; weak direct service coverage | Needs direct list/remove/upsert scenario |
| CAP-007 | Exchange rates | Focused service coverage | No blocker; infra cache decision needed for multi-replica |
| CAP-008 | Company lookup | Shared-service behavior plus throttle policy; invoice wrapper weak | Needs route/autofill scenario |

## CAP-001 Invoice Management

Parity requirements:

- Tenant-scoped list/detail/update/delete.
- Portal-origin invoice cannot be edited/deleted like manual invoice.
- Manual invoice create remains AP-only and non-Vietnam partner only.
- Manual totals are server-computed from line items.
- Partner default terms drive due date.
- Summary/forecast exclude non-recoverable AR and normalize foreign currency through exchange rates.
- AR settlement, non-recoverable, and installments keep rollup fields consistent.
- AP settlement is not directly user-settable.
- Send invoice uses shared email builder, stamps send/tracking fields, and records recipient best-effort.
- Tracking pixel records first open only and returns GIF even on failure.

Evidence:

- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`
- `apps/backend/src/modules/invoice/features/email-tracking/email-tracking.service.spec.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.controller.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.ts`
- `apps/frontend/src/modules/invoice/features/invoices/components/dashboard/forecast-chart.test.ts`
- `packages/shared-types/src/invoice.ts`
- `packages/shared-types/src/invoice-email.ts`

Gaps to prove in new repo:

- Full browser scenario for dashboard/list/detail/form/send.
- Email preview/delivery shape against real mail infra if provider changes.
- Route-level auth/module-access behavior if new backend stack differs.

Unresolved behavior:

- Manual create fallback due-days behavior appears different from DB default partner terms in some paths. Preserve old behavior until product explicitly changes it.

## CAP-002 Tax Portal Sync

Parity requirements:

- GDT sync only available for Vietnamese MST tenants and configured GDT endpoint.
- Start requires two acknowledgements.
- Date window validation rejects invalid/future/too-large windows.
- Scope tax codes are normalized, deduped, and validated.
- Password is scrubbed; token/captcha are Redis-only.
- One active sync job per tenant and idempotency key prevents duplicate start.
- Worker imports sold as AR and purchased as AP.
- Existing imported invoices update source fields but preserve tenant-owned payment metadata.
- Settled invoice outstanding amount is not overwritten by re-sync.
- Partner name updates only from newest invoice date.
- Auto-paid apply runs after sync and failure is best-effort.

Evidence:

- `apps/backend/src/modules/invoice/features/sync/sync-validation.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/sync-persistence.service.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/gdt/invoice-normalizer.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/gdt/gdt-fetcher.service.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/sync.service.ts`
- `apps/backend/src/modules/invoice/features/sync/sync.processor.ts`
- `apps/backend/src/modules/invoice/features/sync/sync-persistence.service.ts`
- `packages/shared-types/src/invoice-sync.ts`

Gaps to prove in new repo:

- Integration test or scripted scenario for start/auth/enqueue/poll lifecycle.
- Redis key TTL/cooldown/lock behavior.
- BullMQ retry/attempt behavior. Old worker job is effectively idempotent through DB keys, but infra retry policy changes can alter execution timing.
- GDT sandbox/mock contract test for captcha/login/fetch pages if HTTP client changes.

Migration blocker:

- Yes for declaring sync complete: new infra must prove Redis/BullMQ/GDT orchestration parity, not only persistence parity.

## CAP-003 Partner Payment Terms

Parity requirements:

- Partner list is tenant-scoped and searchable.
- Update only mutates `defaultDueDays`.
- Match by tax code takes priority and does not fall back to name when tax code misses.
- Name-only match is case-insensitive.
- Terms are consumed by manual invoice create/update and sync persistence.

Evidence:

- `apps/backend/src/modules/invoice/features/partners/partners.service.spec.ts`
- `apps/backend/src/modules/invoice/features/partners/partners.service.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/sync-persistence.service.spec.ts`

Gaps to prove in new repo:

- UI settings scenario for edit/save/search.
- Migration/data backfill scenario if existing partners have null/legacy term data.

Migration blocker:

- No, but migrate before invoice create/sync parity checks.

## CAP-004 Auto-Paid

Parity requirements:

- Rule add upserts tenant tax code.
- Adding a rule bulk-settles matching AP invoices that are not settled and not excluded.
- Removing a rule reverts invoices that were auto-settled by that rule.
- Manual AP create consults auto-paid rules.
- Sync completion applies all tenant rules.
- Reverse auto-paid marks invoice unpaid and `autoPayExcluded=true`.

Evidence:

- `apps/backend/src/modules/invoice/features/auto-paid/auto-paid.service.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`
- `apps/backend/src/modules/invoice/features/sync/sync.processor.ts`

Gaps to prove in new repo:

- Direct integration test for add/remove/applyAll raw SQL effects.
- Race/idempotency scenario for repeated add/remove and sync re-run.
- UI settings scenario.

Migration blocker:

- Not for reading/listing invoices, but yes before declaring manual AP create and sync parity complete.

## CAP-005 Payment Confirmations

Parity requirements:

- Request is AP-only and rejects settled invoices.
- Optional installment request validates target installment and unpaid status.
- Mail failure rolls back the created confirmation.
- New request supersedes older pending request for same invoice/installment.
- Public preview is safe and unauthenticated.
- Public confirm is idempotent after confirmed, rejects rejected/expired tokens, and settles AP invoice or installment.
- Incoming AR accept matches a pending AP confirmation by invoice identity and settles both sides in one transaction.
- Incoming reject marks matching confirmation rejected.

Evidence:

- `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.service.spec.ts`
- `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.service.ts`
- `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.controller.ts`
- `apps/backend/src/modules/invoice/features/payment-confirmations/public-payment-confirmations.controller.ts`
- `apps/backend/src/infra/throttler/throttle-policy.spec.ts`

Gaps to prove in new repo:

- Public URL end-to-end with real frontend route and email link.
- Mail provider behavior if infra changes.
- Throttle behavior if request limiting stack changes.

Migration blocker:

- No business blocker; infra endpoint/mail parity must be proven before production cutover.

## CAP-006 Company Email Memory

Parity requirements:

- List emails by tenant/company.
- Record recipient email after send/request as best-effort.
- Remove saved email tenant-scoped.
- Duplicate email should not create duplicate rows.

Evidence:

- `apps/backend/src/modules/invoice/features/company-emails/company-emails.service.ts`
- `apps/backend/src/modules/invoice/features/company-emails/company-emails.controller.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`
- `apps/backend/src/modules/invoice/features/payment-confirmations/payment-confirmations.service.spec.ts`

Gaps to prove in new repo:

- Direct service/API test for list/remove/upsert and tenant scoping.
- UI recipient picker scenario.

Migration blocker:

- No, but required before send-invoice and payment-confirmation user parity.

## CAP-007 Exchange Rates

Parity requirements:

- VND returns rate 1.
- Foreign rates convert as `rates.VND / rates[currency]`.
- Snapshot cache is reused until TTL.
- Stale snapshot is returned when upstream fails.
- No snapshot plus upstream failure returns service unavailable.
- Invalid upstream response is rejected.

Evidence:

- `apps/backend/src/modules/invoice/features/exchange-rates/exchange-rates.service.spec.ts`
- `apps/backend/src/modules/invoice/features/exchange-rates/exchange-rates.service.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`

Gaps to prove in new repo:

- Contract test against chosen rate provider/mock.
- Multi-replica cache decision. Old repo uses process-local cache, not Redis.

Migration blocker:

- No if old process-local behavior is accepted. Yes if new infra requires shared cache semantics because that is a design change.

## CAP-008 Company Lookup

Parity requirements:

- Invoice lookup route is module-gated.
- Lookup validates country-aware identifiers through shared DTO/service.
- Results are cached in `invoice.company_registry`.
- Provider outage can serve stale cache where shared service allows it.
- Lookup does not create invoice partner records by itself.

Evidence:

- `apps/backend/src/modules/invoice/features/company-lookup/company-lookup.controller.ts`
- `apps/backend/src/common/company-lookup/company-lookup.service.ts`
- `apps/backend/src/common/company-lookup/*provider*.ts`
- `apps/backend/src/infra/throttler/throttle-policy.spec.ts`
- `packages/shared-types/src/company-lookup.ts`

Gaps to prove in new repo:

- Invoice wrapper route test for auth/module access and DTO validation.
- Frontend autofill scenario.
- Provider mock tests for each jurisdiction used in target deployment.

Migration blocker:

- No for invoice persistence. Required for form autofill parity.

## Cross-Capability Scenarios To Run After Port

Run these after the new repo has implementation:

1. Create manual AP invoice for a foreign partner with default terms and auto-paid rule.
2. Import portal sold/purchased invoices, re-run sync, and confirm tenant payment metadata is preserved.
3. Send AR invoice, open tracking pixel, and verify recipient memory.
4. Request AP payment confirmation, confirm public link, and verify AP settlement.
5. Create matching AR/AP invoices, accept incoming payment claim, and verify both rows settle.
6. Add AR installment plan, request installment confirmation, confirm one installment, and verify rollup.
7. Mark AR invoice non-recoverable and verify summary/forecast exclusion.
8. View summary/forecast with USD invoice and upstream rate provider unavailable after/without cache.
9. Lookup company identifier in invoice form and verify no partner row is created until invoice save.

## Blocking Open Questions

These do not block understanding old repo behavior, but they block changing behavior during migration:

- Should manual invoice fallback due days keep the old UI/service behavior or align to DB default 30?
- Should exchange-rate cache remain process-local in the new infra?
- Should sync worker retry policy stay equivalent to old behavior, or become a new idempotent retry design?
- Should AP direct settlement remain blocked? Old repo says yes.
- Should old enum/status values with low usage remain? Old repo says keep unless product removes them.
