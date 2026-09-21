# SPEC: Appointments Booking Overview parity

## Goal

Clone the existing Prive Booking Overview into Operis at
`/backend/appointments/booking-overview`. This is a parity migration, not a
behavior redesign. The legacy dashboard is a visual and interaction reference;
Operis appointments/resources/assignments are the only runtime data sources.

## Decisions

- Keep `/backend/appointments` as the existing Operis list page.
- Booking Overview defaults to today's date and the user's current organization.
- Users may switch only to organizations allowed by the existing scope/ACL.
- Use the existing Operis appointment status catalog directly.
- Preserve the Prive timeline/calendar, booking modal, unconfirmed tray,
  quick walk-in, fit-screen mode, responsive behavior, and realtime refresh.
- Preserve deposit parity with `paymentStatus`, `depositAmount`,
  `depositPaymentMethod`, and `depositPaidAt`.
- Use Operis semantic design tokens; do not change the global Operis theme.

## Scope

- Add a tenant/org-scoped daily overview API based on appointments and resource
  assignments.
- Add deposit fields and guarded update behavior to appointment APIs.
- Add the Booking Overview backend page and translated strings.
- Add API/UI tests for organization/date filtering, deposit updates, modal
  actions, and empty/loading/error states.

## Non-goals

- No redirect or dependency on the old dashboard.
- No legacy dashboard API calls.
- No replacement of `/backend/appointments`.
- No global theme change.
