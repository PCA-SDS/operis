# Public Booking Service Localization

## TLDR

Localize the public Catalog bookable-services response using existing `entity_translations` rows. The booking form sends its active locale, keys service queries by locale, and does not render a hardcoded service catalog while API data is unavailable.

## Overview

Catalog already stores translations for products, categories, option groups, and options. The public booking helper constructs a nested response outside the CRUD translation-overlay pipeline, so its current payload remains in the source language. The booking form also omits locale and can show its static service catalog when the request is pending or fails.

## Problem Statement

Different locales can show untranslated service names/options, and an API failure can silently replace tenant catalog data with an unrelated bundled menu. Locale switching may also reuse cached data if locale is not part of the query key.

## Proposed Solution

- Add an optional `locale` query parameter to the existing public endpoint.
- Batch-load translations for only the entity IDs in the already tenant-scoped bookable response; honor the entity's organization scope and tenant fallback without widening catalog visibility.
- Overlay translated product/category/group/option fields while leaving missing translations and requests without locale unchanged.
- Include category slug in the response so public tab grouping remains stable when category labels are localized.
- Send active locale from booking form and include it in the React Query key.
- Render explicit loading, error/retry, and empty states rather than the local menu when API data is unavailable.

## API Contract

`GET /api/catalog/bookable-services?tenantId=<uuid>&organizationId=<uuid>&locale=<locale>` remains backward-compatible. The new locale parameter is optional. Additive response fields expose nullable `categoryPath[].slug`, `option.note`, and `option.unit`; localized text replaces the same existing text fields. No DB schema or translation data changes are required.

## Risks & Impact Review

| Scenario                                            | Severity | Mitigation                                                                                                                         | Residual risk |
| --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Translation query accidentally widens catalog scope | High     | Restrict lookup to IDs returned by the existing scoped catalog query and exact tenant; match returned entities' organization scope | Low           |
| Missing locale translation                          | Low      | Preserve source-language field value                                                                                               | Low           |
| Locale omitted by an older client                   | Low      | Keep current unlocalized payload behavior                                                                                          | Low           |
| Service API unavailable                             | Medium   | Show translated retry state; never silently show stale local catalog                                                               | Low           |

## Integration Test Coverage

- API: requested locale overlays product, category, group, and nested option names; an absent translation keeps the source value; a translation in another tenant or organization is not applied.
- API: requests without `locale` retain the existing response.
- UI: locale is sent to the API and isolates React Query cache entries; pending/error/empty responses do not display bundled service items and error state can retry.

## Implementation Plan

1. Extend the Catalog endpoint locale contract and apply batched, scope-safe overlays to its nested payload; cover translations and scope behavior with unit/route tests.
2. Pass active locale from booking form, use it in the query key, and remove static catalog fallback from the picker; add loading/error/empty UI states and locale strings.
3. Run focused API tests and booking-form checks, then inspect the diff for compatibility and scope.

## Final Compliance Report

- No database schema, persisted identifiers, endpoint URL, or existing response fields are removed.
- Tenant and organization catalog selection stays owned by the existing Catalog listing function.
- User-visible UI states use the booking form locale files.
- Automated checks are listed in implementation status after execution.

## Changelog

- 2026-09-16: Initial specification for localized public bookable-services data.

## Implementation Status

| Phase                                            | Status      | Date       | Notes                                                                                                                                                                 |
| ------------------------------------------------ | ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 — Catalog API localization               | Done        | 2026-09-16 | Tenant/org-scoped overlays; additive slug/note/unit fields; core typecheck/build and 15 focused route/helper tests pass.                                             |
| Phase 2 — Booking form locale and failure states | Done        | 2026-09-16 | Locale-aware request/cache, slug grouping, no picker fallback, translated loading/error/empty states; form TypeScript check and Vite build pass. Browser QA remains. |

### Verification Notes

- Runner: local; no compose `app` service was running.
- Core: `yarn workspace @open-mercato/core typecheck`, `build`, and the two focused Jest suites passed.
- Booking form: `npm test` and `vite build` passed. Vite reports existing chunk-size and dynamic/static import warnings.
- Booking form lint remains non-clean due existing unused catch-variable and React effect state-update errors in touched source files; no new lint error was reported in the locale request/mapper changes.
- No database migration or data mutation was performed. Changes have not been committed or deployed.
