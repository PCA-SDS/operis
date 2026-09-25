# User Organization Memberships and Staff Provisioning

## 📝 TLDR

Allow one internal auth account to be assigned to multiple organizations without duplicating credentials. A tenant-scoped membership table becomes the source of truth for organization assignment, while the existing `users.organizationId` remains the user's home organization for compatibility. When the optional staff module is enabled, membership changes provision or archive organization-scoped staff team-member records through a persistent event.

## 📝 Problem Statement

The `users` table stores one `organizationId`, while `staff_team_members` stores one organization per staff profile. The current staff command validates `user.organizationId === target organization`, so an account created in Organization A cannot be linked to a staff profile in Organization B. Duplicating accounts would create separate credentials and split the user's identity.

## 📝 Proposed Solution

Add `directory_user_organization_memberships` with one active row per user and organization. Directory owns the cross-cutting organization-assignment record so organization scope resolution can consume it without importing auth entities. Existing users are backfilled from their current `users.organizationId`. The auth user form can manage multiple organization assignments. Auth emits a persistent membership-change event; the optional staff module consumes it and idempotently creates or archives only its auto-provisioned staff profiles. Organization-local staff settings remain independent.

The membership relation controls assignment and organization visibility. RBAC continues to control feature permissions; adding a membership must not silently rewrite ACL grants.

## 📝 Architecture

```text
auth user form/API
        |
        v
UserOrganizationMembership
        |
        | auth.user.organization_memberships_changed (persistent)
        v
staff subscriber (optional)
        |
        v
StaffTeamMember per organization
```

Directory owns the membership entity and scope lookup. Auth owns the user CRUD orchestration, API response, and event. Staff owns provisioning behavior and may be absent. Auth must not import staff entities. Provisioning is idempotent and records which staff rows were created by membership automation so removing a membership does not deactivate a manually managed staff profile.

Organization scope resolution and the organization switcher will use active memberships for normal users, intersected with ACL organization restrictions. Super-admin behavior remains unchanged. During the first slice, the existing home organization is retained as a compatibility fallback while membership data is backfilled.

## 📝 Data Model

New directory entity `UserOrganizationMembership` / table `directory_user_organization_memberships`:

| Field | Purpose |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | Tenant scope |
| `user_id` | Auth user identifier |
| `organization_id` | Directory organization identifier |
| `is_active` | Assignment status; removal archives rather than hard-deletes |
| `created_at`, `updated_at`, `deleted_at` | Standard lifecycle fields |

Add a unique constraint over `(tenant_id, user_id, organization_id)` and a tenant/user index for scope lookups. Membership removal is represented by `is_active = false`, so reactivation reuses the same row. No ORM relation to the directory organization is added; the organization ID remains scalar.

The staff entity gains an automation marker or equivalent staff-owned mapping so provisioning can distinguish an automatically created profile from an existing manually managed profile. Staff role assignments are synchronized only when the user form explicitly submits them; ordinary membership-only changes do not rewrite staff roles. Existing staff rows are used as the initial role values in the assignment form.

## 📝 API Contracts

Extend the internal user CRUD payloads with optional `organizationIds: string[]` and `staffRoleAssignments: { organizationId: string; roleIds: string[] }[]` on create/update. The existing singular `organizationId` continues to mean home organization. User list/detail responses include `organizationIds` for edit-form hydration. Staff role options and existing per-organization assignments are read through the staff-owned `GET /api/staff/user-assignments` route, while the auth command remains decoupled from staff entities.

Validation requires UUIDs, deduplicates IDs, confirms every organization belongs to the target tenant, and checks the actor's organization scope before mutation. Update membership writes run in the same transaction as the user mutation; create provisions the membership immediately after the user row is created, matching the existing create command boundary. A persistent `auth.user.organization_memberships_changed` event carries `tenantId`, `userId`, the resulting active `organizationIds` set, and optional explicit staff role assignments. The staff subscriber validates role IDs against their organization and synchronizes them for the submitted user assignment.

The staff team-member create/update guard accepts a user when the user belongs to the same tenant and has an active membership for the target organization; it no longer requires the user's home organization to equal the target organization.

## 📝 UI/UX

The auth user form adds a multi-select `Organizations` field and an organization-to-staff-role assignment matrix. It loads organizations for the selected tenant, hydrates current memberships and existing staff roles, keeps the home organization separate, supports applying matching role names across organizations, and submits everything with one user update. If an organization is removed, the form does not promise deletion of historical staff data; the backend archives the auto-provisioned profile.

The user picker in the staff team-member form can find accounts through active membership in the current organization.

## 📝 Edge Cases & Failure Scenarios

- Replayed membership events must produce no duplicate auto-provisioned profiles.
- Removing an organization must not hard-delete staff history or manually managed profiles.
- An organization from another tenant must be rejected before persistence.
- A user with no membership remains readable through the compatibility fallback only during migration-safe operation; new managed assignments must create an active membership.
- ACL restrictions can still deny features after membership assignment; the UI/API must not treat membership as an RBAC grant.
- If the staff module is disabled, auth membership changes still succeed and no staff side effect is attempted.
- If a legacy user already has staff profiles in multiple organizations, the staff migration backfills those organizations into the directory membership table before role assignment is edited.

## 📝 Risks & Impact Review

The migration is additive and backfills one row per existing user with a non-null home organization. The singular home organization remains in place, so login/session compatibility is preserved. New event and API fields are additive. The main residual risk is stale staff provisioning after a subscriber failure; persistent delivery and idempotent handling provide retry safety. `yarn db:migrate` is not run by the coding agent.

## 📋 Phasing

Phase 1: membership entity, migration/backfill, user CRUD/API, and unit/integration coverage.

Phase 2: user-form organization assignment and membership-aware user lookup.

Phase 3: optional staff provisioning, organization-specific staff role assignment, staff guard changes, and end-to-end cross-organization staff coverage.

## 📋 Implementation Plan

1. Add the membership entity, validators/helpers, generated entity registration, migration, and backfill test.
2. Add membership loading and synchronization to auth user create/update commands and user API responses.
3. Add the multi-organization user-form field and localization strings.
4. Add the persistent auth event and staff subscriber with idempotent create/archive behavior.
5. Replace staff's home-organization equality check with active-membership validation and update the user picker query.
6. Run generation, focused auth/staff tests, typecheck, and the relevant lint/build checks; update this spec changelog with verified status.

## Changelog

- 2026-09-24: Initial implementation spec for multi-organization auth memberships and optional staff provisioning.
- 2026-09-24: Implemented membership persistence, user CRUD/UI assignment, scope-aware lookup, staff provisioning, migration/backfill, and focused tests on `feature/user-organization-memberships`.
- 2026-09-24: Extended the user flow with one-screen organization-specific staff role assignment, legacy staff-org backfill, role synchronization events, staff assignment lookup API, and subscriber coverage.
