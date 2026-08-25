# Appointments Module

Phase 1: public booking intake + staff list/detail/status. No public form UI and no seat planner in this slice.

## Always

- Scope appointment rows by `tenantId` (and org for booking create / catalog load).
- Customer identity is tenant-wide via `customers` find-or-create; `organizationId` on create is first-touch / booking branch.
- Snapshot customer + line fields on the appointment (do not rely on live catalog/customer joins for historical bookings).
- Public create always lands in system status `new_request`.
- Bookable services come from `catalog` `listBookableServicesForOrganization` only.

## Ask First

- Public create payload contract changes.
- Adding staff UI pages or planner/seat assignment.

## Never

- Never ORM-link to `customers` / `catalog` entities.
- Never create an appointment without `organizationId` + `requestedStartAt` + ≥1 line.
- Never trust client-supplied prices/titles for lines — resolve from bookable services.

## Key paths

| Path | Role |
|------|------|
| `POST /api/appointments/public/create` | Public intake (`requireAuth: false`) |
| `GET /api/appointments` | Staff list |
| `GET /api/appointments/:id` | Staff detail + lines |
| `PATCH /api/appointments/:id` | Status update |
| `lib/intake.ts` | Find-or-create + bookable validation + snapshots |

## Validation

```bash
yarn generate
yarn workspace @open-mercato/core test -- appointments
```
