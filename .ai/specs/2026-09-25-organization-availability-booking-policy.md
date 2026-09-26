# Organization Availability and Booking Policy

## TLDR

Organization operating hours are the only store-level baseline. A resource schedule is an additional constraint. `lastCustomerAcceptanceTime` controls the latest start time for a new booking, while `timeOverflowMinutes` controls how far an existing booking may continue after operating close and how far the timeline may extend.

## Overview

The planner already stores reusable availability rulesets, and resources can reference one. That reference does not identify the official store schedule. This change adds an explicit organization policy that points to the official operating-hours ruleset; the two booking/timeline offsets are stored on each weekly or date-specific availability window in that ruleset.

## Problem Statement

Inferring store hours from the first ruleset attached to a resource is ambiguous because a resource may reference any number of reusable rulesets. It also conflates the physical store closing time with the last time at which a customer may start a booking.

## Proposed Solution

Add `PlannerOrganizationAvailabilitySettings` with:

- `operatingHoursRuleSetId`: explicit official organization operating-hours ruleset.

Add nullable per-rule fields on `PlannerAvailabilityRule`:

- `lastCustomerAcceptanceTime`: absolute local time at which a new booking may start on that window's day.
- `timeOverflowMinutes`: allowed runtime/timeline extension after that window's operating end.

The effective resource windows are:

```text
organizationOperatingHours + window.timeOverflow
  ∩ resourceAvailability
```

New bookings must start no later than `window.lastCustomerAcceptanceTime` and must end no later than `operatingEnd + window.timeOverflowMinutes`. The acceptance time must not be after operating close. Existing appointment assignments may finish in the overflow window, but may not start after operating close. Assignments using the official organization ruleset use the organization overflow as their runtime boundary; independent resource schedules remain hard constraints.

## Architecture

The settings entity belongs to the planner module and uses scalar IDs only. It has no ORM relationship to directory or resources. Runtime resolution selects an explicit settings row for the requested organization, then an explicitly configured ancestor scope where the existing organization scope allows inheritance. It never selects a ruleset by position or by resource reference.

If no organization policy is configured, legacy resource-only behavior remains available for compatibility, but no resource schedule is treated as the store schedule.

## Data Models

Table: `planner_organization_availability_settings`.

Unique scope: `(tenant_id, organization_id)`.

Defaults: legacy organization-level offsets are `0` and are retained only as a compatibility fallback for rules created before per-window fields existed. New schedule editing writes explicit per-window values. The migration/backfill must only link an exact, unambiguous `Standard Business Hours` ruleset and must not guess when none exists.

## API Contracts

`GET /api/planner/organization-availability-settings` returns `configured`, the official ruleset ID, both offsets, and `updatedAt`.

`PUT /api/planner/organization-availability-settings` saves the explicit ruleset link. The ruleset must belong to the selected tenant and organization. Weekly and date-specific availability endpoints accept and persist the two non-negative per-window minute values.

Resource availability responses expose effective windows. Appointment intake rejects starts after the last-customer cutoff and ends after the operating-hours-plus-overflow boundary.

## Risks & Impact Review

- Existing tenants without an explicit organization policy are not assigned a guessed ruleset.
- Existing resource-only behavior is preserved until a policy is configured.
- `Standard Business Hours` data currently describes 09:00–22:00 in the migration; no last-customer or overflow value is inferred from conflicting legacy locale text.
- A later migration may backfill the explicit link only after confirming the ruleset is unique for an organization.

## Final Compliance Report

- Tenant and organization scope: implemented in settings command and resolver.
- Official schedule ambiguity: resolved with an explicit settings link.
- Store close versus last customer: represented by an operating end time and a separate absolute acceptance time.
- Overflow: applied to appointment assignment runtime, booking intake, and timeline bounds; it does not extend the start boundary for new or existing appointments.
- Resource overrun: rejected when a linked resource ruleset exceeds the configured operating-hours boundary; overflow does not make new resource availability valid.

## Changelog

### 2026-09-25

- Added organization-level operating-hours policy model and runtime resolver.
- Added settings API and booking/resource enforcement paths.
- Added organization-based timeline windows with overflow support.
- Moved last-customer and overflow configuration into weekly/date-specific schedule windows; the organization settings record now only identifies the official schedule (with legacy offset fallback).
