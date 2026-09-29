# Organization Availability and Booking Policy

## TLDR

Organization operating hours are the branch-level baseline. A resource may optionally set its own last-customer cutoff and overflow in Availability; when omitted, it inherits the branch policy. `lastCustomerAcceptanceTime` controls the latest start time for a new booking, while `timeOverflowMinutes` controls how far an assigned booking may continue after that schedule's close and how far the timeline may extend.

## Overview

The planner already stores reusable availability rulesets, and resources can reference one. That reference does not identify the official store schedule. An organization policy points to the official operating-hours ruleset; activation remains an explicit action in the ruleset Details tab so editing a reusable schedule cannot silently change the branch baseline. The two booking/timeline offsets are stored on each weekly or date-specific availability window in that ruleset.

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
if resource has explicitly configured availability:
  resourceAvailability + its window cutoff/overflow
otherwise:
  organizationOperatingHours + its window cutoff/overflow
```

When a resource has explicitly configured availability, that schedule—including its operating hours, last-customer cutoff, and overflow—is authoritative for that resource and replaces the branch schedule there. It is not intersected with the branch policy. Resources without explicit resource availability inherit the branch schedule and its cutoff/overflow. The appointment's original start is checked only against the booking cutoff; each assigned service is checked against the actual resource window containing that service's start and end. This lets a later service use a resource that opens after the appointment began, a later split window, or that resource's overflow. It must still end by that window's runtime end. A new appointment cannot start during overflow. Resource-specific settings do not affect sibling resources or the branch policy.

## Architecture

The settings entity belongs to the planner module and uses scalar IDs only. It has no ORM relationship to directory or resources. Runtime resolution selects an explicit settings row for the requested organization, then an explicitly configured ancestor scope where the existing organization scope allows inheritance. It never selects a ruleset by position or by resource reference.

If no organization policy is configured, legacy resource-only behavior remains available for compatibility, but no resource schedule is treated as the store schedule.

## Data Models

Table: `planner_organization_availability_settings`.

Unique scope: `(tenant_id, organization_id)`.

Defaults: legacy organization-level offsets are `0` and are retained only as a compatibility fallback for rules created before per-window fields existed. New schedule editing writes explicit per-window values. The migration/backfill must only link an exact, unambiguous `Standard Business Hours` ruleset and must not guess when none exists.

## API Contracts

`GET /api/planner/organization-availability-settings` returns `configured`, the official ruleset ID, both offsets, and `updatedAt`.

`PUT /api/planner/organization-availability-settings` saves the explicit ruleset link. The ruleset must belong to the selected tenant and organization. The explicit activation action sends the settings record's `updatedAt` as its optimistic-lock token. Weekly and date-specific availability endpoints accept and persist the two non-negative per-window minute values. Saving ruleset, resource, or member availability never changes the organization policy pointer.

Resource availability responses expose effective windows and an optional resource-specific latest start. Appointment intake without a selected resource uses the branch cutoff; assignment validation applies the selected resource's own schedule when configured, or the branch schedule when it is not.

## Risks & Impact Review

- Existing tenants without an explicit organization policy are not assigned a guessed ruleset.
- Resources without a selected/configured custom availability inherit branch operating hours, cutoff, and overflow.
- `Standard Business Hours` data currently describes 09:00–22:00 in the migration; no last-customer or overflow value is inferred from conflicting legacy locale text.
- A later migration may backfill the explicit link only after confirming the ruleset is unique for an organization.

## Final Compliance Report

- Tenant and organization scope: implemented in settings command and resolver.
- Official schedule ambiguity: resolved with an explicit settings link.
- Store close versus last customer: represented by an operating end time and a separate absolute acceptance time.
- Overflow: applied to appointment assignment runtime and timeline bounds. It does not extend the start boundary for a new appointment, but later services in an already-started appointment can use the overflow period.
- Resource-local cutoff and overflow are enforced only on that resource's assignments; they do not change sibling resources or branch settings.

## Changelog

### 2026-09-25

- Added organization-level operating-hours policy model and runtime resolver.
- Added settings API and booking/resource enforcement paths.
- Added organization-based timeline windows with overflow support.
- Moved last-customer and overflow configuration into weekly/date-specific schedule windows; the organization settings record now only identifies the official schedule (with legacy offset fallback).

### 2026-09-28

- Kept organization operating-hours activation explicit in the ruleset Details tab so reusable schedule edits cannot change the organization policy pointer.
- Added optional resource-specific availability; an explicitly selected custom schedule replaces branch policy for that resource, while resources without one inherit branch behavior.
- Allowed later services in an already-started appointment to use resource overflow while keeping the new-booking cutoff strict.
- Separated appointment-anchor cutoff validation from the selected resource's actual service-window validation, including split windows and later services assigned to another resource.
