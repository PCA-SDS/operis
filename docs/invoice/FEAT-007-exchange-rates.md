# FEAT-007 - Exchange Rates

## Description
Lấy VND conversion hints cho invoice create form và dùng để normalize dashboard summary/forecast về VND.

## Purpose
Cho user nhập foreign-currency invoice nhưng vẫn thấy ước tính VND; dashboard có thể cộng AP/AR nhiều currency theo một đơn vị báo cáo.

## User/business value
- Finance team nhìn được exposure bằng VND.
- Create form cho thấy bracketed VND estimates khi nhập USD/EUR/etc.

## Entry points
- API:
  - `GET /invoice/exchange-rates`
- Backend internal:
  - `InvoicesService.getSummary`
  - `InvoicesService.getForecast`
- Frontend:
  - `useExchangeRates`
  - `InvoiceFormPage`
  - Dashboard summary/forecast display.

## Main implementations
- Backend:
  - `apps/backend/src/modules/invoice/features/exchange-rates/exchange-rates.controller.ts`
  - `apps/backend/src/modules/invoice/features/exchange-rates/exchange-rates.service.ts`
- Frontend:
  - `apps/frontend/src/modules/invoice/features/invoices/hooks/use-exchange-rates.ts`
  - `apps/frontend/src/modules/invoice/features/invoices/pages/InvoiceFormPage.tsx`
- Shared contracts:
  - `packages/shared-types/src/invoice.ts`

## Dependencies
- External API: default `https://open.er-api.com/v6/latest/USD` or `EXCHANGE_RATE_API_URL`.
- Infra: fetch, in-memory service cache, ConfigService.

## Inputs
- None from user.
- Upstream USD-based rates response.

## Outputs
- `InvoiceExchangeRatesDto` with `vndPerUnit` for all `INVOICE_CURRENCIES` and `fetchedAt`.

## Side effects
- Updates in-memory cache inside backend process.
- No DB write.

## Failure behavior
- If cache is fresh, returns cache.
- If upstream fails and stale cache exists, returns stale cache.
- If upstream fails with no cache, returns 503.
- Invalid payload/no VND/no supported currency rate fails.

## Retry behavior
- No internal retry loop in `ExchangeRatesService`.
- Caller/user can refetch.

## Migration classification
- `PORTABLE_BUSINESS_LOGIC`: VND-per-unit derivation from USD-based rates, VND = 1, supported currency set.
- `DATA_DEPENDENT`: none.
- `INFRA_DEPENDENT`: external rate provider, in-memory cache, fetch timeout.
- `UI_DEPENDENT`: VND estimate display on create form.

## Capability trace

### CAP-007 - exchange-rates

#### FLOW-001 - Fetch rates for UI
- Trigger: create invoice form renders.
- Entry point: `useExchangeRates` -> `invoicesApi.exchangeRates`.
- Calls: `GET /invoice/exchange-rates` -> `ExchangeRatesService.getRates` -> cache check -> `fetchRates` -> upstream fetch -> derive `vndPerUnit`.
- Execution: for each supported non-VND currency, VND per unit = upstream VND rate / upstream currency rate.
- Retry: frontend query can refetch; no service retry.
- Idempotency: read-only.
- Error handling: 503 if no usable upstream and no cache.
- Other: values are display-only; no converted amount is persisted on manual invoice.

#### FLOW-002 - Normalize dashboard calculations
- Trigger: dashboard summary/forecast query finds foreign-currency invoices.
- Entry point: `InvoicesService.buildVndRates`.
- Calls: collect currencies -> if only VND, skip feed -> otherwise `ExchangeRatesService.getRates` -> convert each Decimal amount to VND.
- Execution: totals and forecast curves report currency `VND`.
- Retry: user retries dashboard query.
- Idempotency: read-only.
- Error handling: missing rate returns 503 rather than silently reporting wrong total.
- Other: FX movement can change dashboard totals over time.

## Legacy/dead logic check
- Cache is process-local. In multi-replica repo mới, decide if process-local stale fallback is acceptable or needs shared cache.
- Default provider URL is infra detail, not business logic.

## Evidence
- `apps/backend/src/modules/invoice/features/exchange-rates/exchange-rates.service.spec.ts`
- `apps/backend/src/modules/invoice/features/invoices/invoices.service.spec.ts`
- `packages/shared-types/src/invoice.ts`
