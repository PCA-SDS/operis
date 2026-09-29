# Returning-customer partial phone search

## TLDR

Booking customer suggestions support partial phone-number queries through tenant-scoped `search_tokens` while keeping phone values encrypted at rest.

## Overview

The Booking Overview create sheet searches returning customers through `GET /api/appointments/customer-search`. Phone-number fragments are normalized to digits and matched against the customer entity's `primary_phone` search tokens.

The Appointments table also supports partial phone queries against each appointment's immutable phone snapshot. It removes formatting characters from both query and snapshot before matching, so older bookings remain searchable even if the customer's current phone changes.

## Problem Statement

The encrypted customer phone column cannot support substring matching with SQL `ILIKE`. Deterministic phone hashes support full-number equality only, so partial customer lookup must use the existing token index. Unindexed legacy customers will not match partial-phone queries until their search projection is rebuilt. Appointment rows separately retain phone snapshots, which the appointment-list search can normalize without reading the live customer record.

## Proposed Solution

- Resolve phone matches through `customers:customer_entity` / `primary_phone` tokens.
- Keep every token query scoped to the authenticated tenant, and keep final entity reads tenant-scoped as well.
- For `GET /api/appointments?search=...`, match phone-only queries of at least four digits against normalized `appointments.customer_phone`, bounded by authenticated tenant and then filtered through the existing organization scope.
- For a tenant with existing customers, rebuild the projection and tokens after deploying this behavior:

  ```bash
  yarn mercato query_index rebuild --entity customers:customer_entity --tenant <tenant-id>
  ```

  This rebuilds the customer query-index projection and Postgres `search_tokens`; it does not rebuild the Meilisearch full-text index. New and updated customer writes continue through the normal indexing pipeline.
- Keep referral dictionary creation outside this search change.

## Architecture

The booking endpoint delegates matching to the customer lookup helper. That helper combines display-name token IDs, primary-phone token IDs, and exact deterministic phone/email hash candidates, then loads/decrypts only tenant-scoped matching people. No plaintext phone search is added to SQL. Selecting a suggestion without an email still requests booking history by phone.

## Data Models

No schema changes. The behavior depends on existing `search_tokens` rows for `customers:customer_entity` and field `primary_phone`.

## API Contracts

`GET /api/appointments/customer-search?search=<query>` remains authenticated and tenant-scoped. The public returning-customer lookup accepts an omitted email and continues returning the same response shape.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual risk |
|---|---|---|---|---|
| Existing customer has no phone search tokens | Medium | Returning-customer suggestions | Run the tenant-scoped search reindex command after deployment | Partial phone search remains unavailable for that record until reindex completes |
| Search tokens are scoped to a different tenant | High | Customer data isolation | Scope token lookup and final entity query by authenticated tenant; integration test seeds a matching token under a foreign tenant | None known |

## Final Compliance Report

- Integration coverage exercises the authenticated customer-search API against real search-token rows and verifies tenant isolation.
- Appointment list route coverage verifies formatted partial-phone search uses normalized digits and retains tenant/organization filters.
- No database schema changes. The public customer lookup request now permits an omitted email; callers that provide email remain supported.
- Referral inline creation is not part of this change.

## Changelog

- 2026-09-29 — Documented tenant-scoped partial-phone search, legacy reindex requirement, phone-only returning lookup, and integration coverage.
