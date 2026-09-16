# Appointments Module

Phase 1: public booking intake + staff list/create/detail/status + status catalog settings.
No public form UI and no seat planner in this slice.

## Always

- Scope appointment rows by `tenantId` (and org for booking create / catalog load).
- Customer identity is tenant-wide via `customers` find-or-create; `organizationId` on create is first-touch / booking branch.
- Snapshot customer + line fields on the appointment (do not rely on live catalog/customer joins for historical bookings).
- Public and staff create always land in system status `new_request`.
- Bookable services come from `catalog` `listBookableServicesForOrganization` only.
- Staff create uses auth tenant/org — never trust client-supplied scope on `POST /api/appointments`.
- Status catalog: system rows (`new_request`, `in_progress`, `booked`, `cancelled`) cannot be deleted or renamed; custom rows soft-delete only when unused.

## Ask First

- Public create payload contract changes.
- Adding public booking form UI or planner/seat assignment.
- Adding color/appearance columns to `appointment_statuses` (Privé/ERP parity).

## Never

- Never ORM-link to `customers` / `catalog` entities.
- Never create an appointment without `organizationId` + `requestedStartAt` + ≥1 line.
- Never trust client-supplied prices/titles for lines — resolve from bookable services.
- Never hard-delete status rows; soft-delete customs only.

## Key paths

| Path | Role |
|------|------|
| `POST /api/appointments/public/create` | Public intake (`requireAuth: false`) |
| `GET/POST /api/appointments` | Staff list / create |
| `GET/POST /api/appointments/statuses` | Status catalog list / create |
| `PATCH/DELETE /api/appointments/statuses/:id` | Status catalog update / soft-delete |
| `GET/PATCH /api/appointments/:id` | Staff detail + status |
| `/backend/appointments` | Staff list table |
| `/backend/appointments/create` | Staff create form |
| `/backend/appointments/:id` | Staff detail |
| `/backend/config/appointments` | Settings › Module Configs › status catalog |
| `lib/intake.ts` | Find-or-create + bookable validation + snapshots |
| `lib/statusCatalog.ts` | Status code helpers + DTO mapping |

## Validation

```bash
yarn generate
yarn workspace @open-mercato/core test -- appointments
```
