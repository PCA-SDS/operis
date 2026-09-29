# Returning-customer partial phone search

## TLDR

Booking customer suggestions support partial phone-number queries through tenant-scoped `search_tokens` while keeping phone values encrypted at rest.

## Overview

The Booking Overview create sheet searches returning customers through `GET /api/appointments/customer-search`. Phone-number fragments are normalized to digits and matched against the customer entity's `primary_phone` search tokens.

## Problem Statement

The encrypted phone column cannot support substring matching with SQL `ILIKE`. Deterministic phone hashes support full-number equality only, so partial phone search must use the existing token index. Unindexed legacy customers will not match partial-phone queries until their search projection is rebuilt.

## Proposed Solution

- Resolve phone matches through `customers:customer_entity` / `primary_phone` tokens.
- Keep every token query scoped to the authenticated tenant, and keep final entity reads tenant-scoped as well.
- For a tenant with existing customers, rebuild the projection and tokens after deploying this behavior:

  ```bash
  yarn mercato query_index rebuild --entity customers:customer_entity --tenant <tenant-id>
  ```

  This rebuilds the customer query-index projection and Postgres `search_tokens`; it does not rebuild the Meilisearch full-text index. New and updated customer writes continue through the normal indexing pipeline.
- Keep referral dictionary creation outside this search change.

## Architecture

The booking endpoint delegates matching to the customer lookup helper. That helper combines display-name token IDs, primary-phone token IDs, and exact deterministic phone-hash candidates, then loads/decrypts only tenant-scoped matching people. No plaintext phone search is added to SQL.

## Data Models

No schema changes. The behavior depends on existing `search_tokens` rows for `customers:customer_entity` and field `primary_phone`.

## API Contracts

No API contract changes. `GET /api/appointments/customer-search?search=<query>` remains authenticated and tenant-scoped.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual risk |
|---|---|---|---|---|
| Existing customer has no phone search tokens | Medium | Returning-customer suggestions | Run the tenant-scoped search reindex command after deployment | Partial phone search remains unavailable for that record until reindex completes |
| Search tokens are scoped to a different tenant | High | Customer data isolation | Scope token lookup and final entity query by authenticated tenant; integration test seeds a matching token under a foreign tenant | None known |

## Final Compliance Report

- Integration coverage exercises the authenticated customer-search API against real search-token rows and verifies tenant isolation.
- No database schema or API contract changes.
- Referral inline creation is not part of this change.

## Changelog

- 2026-09-29 — Documented tenant-scoped partial-phone search, legacy reindex requirement, and integration coverage.
